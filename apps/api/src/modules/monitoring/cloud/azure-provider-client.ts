import { ComputeManagementClient } from '@azure/arm-compute';
import { CostManagementClient } from '@azure/arm-costmanagement';
import { MonitorClient } from '@azure/arm-monitor';
import { ClientSecretCredential } from '@azure/identity';
import {
  CloudCostLineItem,
  CloudMetricSample,
  CloudProviderClient,
  CloudResourceRef,
} from './cloud-provider-client';

export interface AzureCredentialsConfig {
  subscriptionId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

const METRIC_WINDOW_MS = 10 * 60 * 1000;

/**
 * Read-only: VirtualMachines.listAll (arm-compute) for resource discovery,
 * Metrics.list (arm-monitor) for "Percentage CPU". Not live-tested against
 * a real Azure subscription in this environment -- see the same disclosure
 * on AwsCloudProviderClient. externalId is the VM's full ARM resource ID
 * (`/subscriptions/.../resourceGroups/.../virtualMachines/...`), which is
 * also exactly what Metrics.list expects as resourceUri.
 */
export class AzureCloudProviderClient implements CloudProviderClient {
  readonly provider = 'azure' as const;
  private readonly compute: ComputeManagementClient;
  private readonly monitor: MonitorClient;
  private readonly costManagement: CostManagementClient;
  private readonly subscriptionId: string;

  constructor(config: AzureCredentialsConfig) {
    const credential = new ClientSecretCredential(
      config.tenantId,
      config.clientId,
      config.clientSecret,
    );
    this.subscriptionId = config.subscriptionId;
    this.compute = new ComputeManagementClient(
      credential,
      config.subscriptionId,
    );
    this.monitor = new MonitorClient(credential, config.subscriptionId);
    this.costManagement = new CostManagementClient(credential);
  }

  async listResources(): Promise<CloudResourceRef[]> {
    const resources: CloudResourceRef[] = [];
    for await (const vm of this.compute.virtualMachines.listAll()) {
      if (!vm.id || !vm.name) continue;
      resources.push({
        externalId: vm.id,
        name: vm.name,
        provider: 'azure',
        region: vm.location,
      });
    }
    return resources;
  }

  async getMetrics(externalId: string): Promise<CloudMetricSample[]> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - METRIC_WINDOW_MS);

    const result = await this.monitor.metrics.list(externalId, {
      timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
      interval: 'PT5M',
      metricnames: 'Percentage CPU',
      aggregation: 'Average',
    });

    const dataPoints = result.value?.[0]?.timeseries?.[0]?.data ?? [];
    const latest = [...dataPoints]
      .reverse()
      .find((point) => point.average !== undefined);
    if (!latest || latest.average === undefined) return [];
    return [
      { metricName: 'Percentage CPU', value: latest.average, unit: 'Percent' },
    ];
  }

  /**
   * startDate/endDate are YYYY-MM-DD. Cost Management's query API returns a
   * generic {columns, rows} table rather than typed objects -- columns are
   * looked up by name since their order isn't part of the documented
   * contract. With granularity=Daily, Azure adds its own 'UsageDate' column
   * as an integer in YYYYMMDD form (e.g. 20260715), not an ISO string.
   */
  async getCostAndUsage(
    startDate: string,
    endDate: string,
  ): Promise<CloudCostLineItem[]> {
    const scope = `/subscriptions/${this.subscriptionId}`;
    const result = await this.costManagement.query.usage(scope, {
      type: 'Usage',
      timeframe: 'Custom',
      timePeriod: { from: new Date(startDate), to: new Date(endDate) },
      dataset: {
        granularity: 'Daily',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        grouping: [
          { type: 'Dimension', name: 'ServiceName' },
          { type: 'Dimension', name: 'ResourceLocation' },
        ],
      },
    });

    const columns = result.columns ?? [];
    const indexOf = (name: string) => columns.findIndex((c) => c.name === name);
    const dateIdx = indexOf('UsageDate');
    const costIdx = indexOf('totalCost');
    const serviceIdx = indexOf('ServiceName');
    const regionIdx = indexOf('ResourceLocation');
    const currencyIdx = indexOf('Currency');

    const lineItems: CloudCostLineItem[] = [];
    for (const row of result.rows ?? []) {
      const service = serviceIdx >= 0 ? row[serviceIdx] : undefined;
      const amount = costIdx >= 0 ? Number(row[costIdx]) : undefined;
      const rawDate = dateIdx >= 0 ? row[dateIdx] : undefined;
      if (!service || amount === undefined || rawDate === undefined) continue;

      const dateDigits = String(rawDate);
      const usageDate = `${dateDigits.slice(0, 4)}-${dateDigits.slice(4, 6)}-${dateDigits.slice(6, 8)}`;

      lineItems.push({
        service,
        region: regionIdx >= 0 ? row[regionIdx] || undefined : undefined,
        usageDate,
        amount,
        currency: currencyIdx >= 0 ? row[currencyIdx] : 'USD',
        raw: { columns: columns.map((c) => c.name), row },
      });
    }
    return lineItems;
  }
}
