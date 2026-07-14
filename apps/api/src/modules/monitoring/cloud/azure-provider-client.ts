import { ComputeManagementClient } from '@azure/arm-compute';
import { MonitorClient } from '@azure/arm-monitor';
import { ClientSecretCredential } from '@azure/identity';
import {
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

  constructor(config: AzureCredentialsConfig) {
    const credential = new ClientSecretCredential(
      config.tenantId,
      config.clientId,
      config.clientSecret,
    );
    this.compute = new ComputeManagementClient(
      credential,
      config.subscriptionId,
    );
    this.monitor = new MonitorClient(credential, config.subscriptionId);
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
}
