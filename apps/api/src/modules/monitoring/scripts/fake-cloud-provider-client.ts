import {
  CloudCostLineItem,
  CloudMetricSample,
  CloudProviderClient,
  CloudProviderClientFactory,
  CloudResourceRef,
} from '../cloud/cloud-provider-client';

/**
 * In-memory stand-in for AwsCloudProviderClient/AzureCloudProviderClient,
 * used only by verify-cloud-polling.ts. Lets the poller's actual logic
 * (resource upsert, external_ref population, threshold evaluation, alert
 * wiring) be verified deterministically without real cloud credentials --
 * see the module-level comment on AwsCloudProviderClient for why the real
 * clients themselves aren't live-tested here.
 */
export class FakeCloudProviderClient implements CloudProviderClient {
  constructor(
    readonly provider: 'aws' | 'azure',
    private resources: CloudResourceRef[],
    private metricsByExternalId: Record<string, CloudMetricSample[]>,
    private costLineItems: CloudCostLineItem[] = [],
  ) {}

  async listResources(): Promise<CloudResourceRef[]> {
    return this.resources;
  }

  async getMetrics(externalId: string): Promise<CloudMetricSample[]> {
    return this.metricsByExternalId[externalId] ?? [];
  }

  async getCostAndUsage(
    startDate: string,
    endDate: string,
  ): Promise<CloudCostLineItem[]> {
    return this.costLineItems.filter(
      (item) => item.usageDate >= startDate && item.usageDate < endDate,
    );
  }

  setMetrics(externalId: string, samples: CloudMetricSample[]): void {
    this.metricsByExternalId[externalId] = samples;
  }

  setCostLineItems(items: CloudCostLineItem[]): void {
    this.costLineItems = items;
  }
}

export function makeFakeFactory(
  clients: Record<string, FakeCloudProviderClient>,
): CloudProviderClientFactory {
  return (provider, config) => {
    const key = String((config as { fakeKey?: string }).fakeKey ?? provider);
    const client = clients[key];
    if (!client) {
      throw new Error(`no fake client registered for key "${key}"`);
    }
    return client;
  };
}
