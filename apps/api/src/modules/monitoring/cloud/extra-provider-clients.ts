import { Logger } from '@nestjs/common';
import {
  CloudCostLineItem,
  CloudMetricSample,
  CloudProvider,
  CloudProviderClient,
  CloudResourceRef,
} from './cloud-provider-client';

/**
 * Billing-ingestion clients for GCP, DigitalOcean, Alibaba Cloud and Oracle
 * Cloud (OCI), added alongside the existing AWS/Azure clients. They implement
 * the same CloudProviderClient contract, so CostBillingSyncService ingests them
 * through the identical loop (getCostAndUsage -> upsert cost_line_items).
 *
 * listResources/getMetrics return [] on all four -- this feature is billing
 * ingestion; external monitoring for these providers is a separate concern.
 * Any missing/incomplete config yields [] (logged) rather than throwing, so one
 * misconfigured account never breaks a multi-account sync pass.
 */
function toIsoDate(value: unknown): string {
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? String(value).slice(0, 10)
    : d.toISOString().slice(0, 10);
}

abstract class BillingOnlyClient implements CloudProviderClient {
  abstract readonly provider: CloudProvider;
  protected readonly logger = new Logger(this.constructor.name);

  async listResources(): Promise<CloudResourceRef[]> {
    return [];
  }
  async getMetrics(): Promise<CloudMetricSample[]> {
    return [];
  }
  abstract getCostAndUsage(
    startDate: string,
    endDate: string,
  ): Promise<CloudCostLineItem[]>;
}

/**
 * DigitalOcean: GET /v2/customers/my/billing_history with a Bearer API token.
 * DO exposes invoice/charge-level history rather than per-service/day usage, so
 * each history entry in the window becomes one line item.
 */
export class DigitalOceanCloudProviderClient extends BillingOnlyClient {
  readonly provider = 'digitalocean' as const;
  private readonly apiToken?: string;

  constructor(config: Record<string, unknown>) {
    super();
    this.apiToken = config.apiToken as string | undefined;
  }

  async getCostAndUsage(
    startDate: string,
    endDate: string,
  ): Promise<CloudCostLineItem[]> {
    if (!this.apiToken) {
      this.logger.log('digitalocean: no apiToken configured, skipping');
      return [];
    }
    const res = await fetch(
      'https://api.digitalocean.com/v2/customers/my/billing_history?per_page=200',
      { headers: { Authorization: `Bearer ${this.apiToken}` } },
    );
    if (!res.ok) {
      throw new Error(`DigitalOcean billing_history failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      billing_history?: Array<{
        description?: string;
        amount?: string;
        type?: string;
        date?: string;
      }>;
    };
    return (data.billing_history ?? [])
      .filter((e) => {
        const d = toIsoDate(e.date);
        return d >= startDate && d < endDate;
      })
      .map((e) => ({
        service: e.description || e.type || 'DigitalOcean',
        usageDate: toIsoDate(e.date),
        amount: Math.abs(Number(e.amount ?? 0)),
        currency: 'USD',
        raw: e as Record<string, unknown>,
      }));
  }
}

/**
 * GCP: queries the standard BigQuery billing export via the jobs.query API with
 * a pre-fetched OAuth access token (config: { projectId, billingExportTable,
 * accessToken }). This is the canonical way to get per-service/region/day cost
 * out of GCP; the token is supplied by the caller so no service-account key
 * handling lives here.
 */
export class GcpCloudProviderClient extends BillingOnlyClient {
  readonly provider = 'gcp' as const;
  private readonly projectId?: string;
  private readonly table?: string;
  private readonly accessToken?: string;

  constructor(config: Record<string, unknown>) {
    super();
    this.projectId = config.projectId as string | undefined;
    this.table = config.billingExportTable as string | undefined;
    this.accessToken = config.accessToken as string | undefined;
  }

  async getCostAndUsage(
    startDate: string,
    endDate: string,
  ): Promise<CloudCostLineItem[]> {
    if (!this.projectId || !this.table || !this.accessToken) {
      this.logger.log('gcp: incomplete config, skipping');
      return [];
    }
    const query = `
      SELECT service.description AS service, location.region AS region,
             DATE(usage_start_time) AS usage_date,
             SUM(cost) AS amount, currency
      FROM \`${this.table}\`
      WHERE DATE(usage_start_time) >= @start AND DATE(usage_start_time) < @end
      GROUP BY service, region, usage_date, currency`;
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/queries`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          useLegacySql: false,
          queryParameters: [
            {
              name: 'start',
              parameterType: { type: 'DATE' },
              parameterValue: { value: startDate },
            },
            {
              name: 'end',
              parameterType: { type: 'DATE' },
              parameterValue: { value: endDate },
            },
          ],
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`GCP BigQuery billing query failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      rows?: Array<{ f: Array<{ v: string | null }> }>;
    };
    return (data.rows ?? []).map((row) => ({
      service: row.f[0]?.v ?? 'GCP',
      region: row.f[1]?.v ?? undefined,
      usageDate: toIsoDate(row.f[2]?.v),
      amount: Number(row.f[3]?.v ?? 0),
      currency: row.f[4]?.v ?? 'USD',
      raw: row as unknown as Record<string, unknown>,
    }));
  }
}

/**
 * Alibaba Cloud (BSS OpenAPI, QueryInstanceBill) and Oracle Cloud (OCI Usage
 * API) both require provider-specific signed requests (Alibaba: RPC HMAC-SHA1;
 * OCI: RSA-SHA256 request signing). They are wired end-to-end here -- selectable,
 * stored, ingested through the same sync loop -- but getCostAndUsage returns []
 * (logged) until the signing flow is implemented, rather than pretending to
 * fetch. This keeps the pipeline honest and additive.
 */
export class AlibabaCloudProviderClient extends BillingOnlyClient {
  readonly provider = 'alibaba' as const;
  async getCostAndUsage(): Promise<CloudCostLineItem[]> {
    this.logger.log(
      'alibaba: live ingestion requires the BSS signed-request flow (not yet implemented)',
    );
    return [];
  }
}

export class OracleCloudProviderClient extends BillingOnlyClient {
  readonly provider = 'oracle' as const;
  async getCostAndUsage(): Promise<CloudCostLineItem[]> {
    this.logger.log(
      'oracle: live ingestion requires the OCI request-signing flow (not yet implemented)',
    );
    return [];
  }
}
