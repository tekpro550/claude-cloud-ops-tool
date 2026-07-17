/** Every cloud provider the platform can hold credentials for and bill from. */
export type CloudProvider =
  'aws' | 'azure' | 'gcp' | 'alibaba' | 'digitalocean' | 'oracle';

export const CLOUD_PROVIDERS: readonly CloudProvider[] = [
  'aws',
  'azure',
  'gcp',
  'alibaba',
  'digitalocean',
  'oracle',
];

export interface CloudResourceRef {
  externalId: string;
  name: string;
  provider: CloudProvider;
  region?: string;
}

export interface CloudMetricSample {
  metricName: string;
  value: number;
  unit?: string;
}

/**
 * One row per service+region+day, matching what both AWS Cost Explorer
 * (GetCostAndUsage, Granularity=DAILY, GroupBy SERVICE+REGION) and Azure
 * Cost Management (query.usage, granularity=Daily, grouping by
 * ServiceName+ResourceLocation) return -- the shape CostBillingSyncService
 * upserts directly into cost_line_items, see
 * docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md section 3.
 */
export interface CloudCostLineItem {
  service: string;
  region?: string;
  usageDate: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  /**
   * Cost-allocation tags for this line item (e.g. { team: 'platform',
   * environment: 'prod' }). Optional -- providers that aren't configured with
   * activated cost-allocation tags simply omit it, and it stores as {}.
   */
  tags?: Record<string, string>;
  raw: Record<string, unknown>;
}

/**
 * One implementation per provider (AwsCloudProviderClient,
 * AzureCloudProviderClient) behind this interface, the same way
 * ObjectStorage abstracts LocalDiskStorage for attachments -- lets
 * CloudResourcePollerService stay provider-agnostic and, more importantly,
 * lets it be verified against a fake in tests without real cloud credentials.
 */
export interface CloudProviderClient {
  readonly provider: CloudProvider;
  listResources(): Promise<CloudResourceRef[]>;
  getMetrics(externalId: string): Promise<CloudMetricSample[]>;
  /** startDate/endDate are YYYY-MM-DD, end exclusive (matches AWS Cost Explorer's own TimePeriod semantics). */
  getCostAndUsage(
    startDate: string,
    endDate: string,
  ): Promise<CloudCostLineItem[]>;
}

export type CloudProviderClientFactory = (
  provider: CloudProvider,
  config: Record<string, unknown>,
) => CloudProviderClient;

export const CLOUD_PROVIDER_CLIENT_FACTORY = Symbol(
  'CLOUD_PROVIDER_CLIENT_FACTORY',
);
