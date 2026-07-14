export interface CloudResourceRef {
  externalId: string;
  name: string;
  provider: 'aws' | 'azure';
  region?: string;
}

export interface CloudMetricSample {
  metricName: string;
  value: number;
  unit?: string;
}

/**
 * One implementation per provider (AwsCloudProviderClient,
 * AzureCloudProviderClient) behind this interface, the same way
 * ObjectStorage abstracts LocalDiskStorage for attachments -- lets
 * CloudResourcePollerService stay provider-agnostic and, more importantly,
 * lets it be verified against a fake in tests without real cloud credentials.
 */
export interface CloudProviderClient {
  readonly provider: 'aws' | 'azure';
  listResources(): Promise<CloudResourceRef[]>;
  getMetrics(externalId: string): Promise<CloudMetricSample[]>;
}

export type CloudProviderClientFactory = (
  provider: 'aws' | 'azure',
  config: Record<string, unknown>,
) => CloudProviderClient;

export const CLOUD_PROVIDER_CLIENT_FACTORY = Symbol(
  'CLOUD_PROVIDER_CLIENT_FACTORY',
);
