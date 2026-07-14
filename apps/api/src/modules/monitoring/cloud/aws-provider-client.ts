import {
  CloudWatchClient,
  GetMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import {
  CloudMetricSample,
  CloudProviderClient,
  CloudResourceRef,
} from './cloud-provider-client';

export interface AwsCredentialsConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const METRIC_WINDOW_MS = 10 * 60 * 1000;

/**
 * Read-only: DescribeInstances (EC2) for resource discovery, GetMetricData
 * (CloudWatch) for CPUUtilization. Not live-tested against a real AWS
 * account in this environment (no credentials/network path to AWS from this
 * sandbox) -- CloudResourcePollerService, which is the part with the actual
 * business logic (resource upsert, threshold evaluation, alert wiring), is
 * fully verified against a fake CloudProviderClient instead. See
 * verify-cloud-polling.ts.
 */
export class AwsCloudProviderClient implements CloudProviderClient {
  readonly provider = 'aws' as const;
  private readonly ec2: EC2Client;
  private readonly cloudwatch: CloudWatchClient;
  private readonly region: string;

  constructor(config: AwsCredentialsConfig) {
    this.region = config.region;
    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
    this.ec2 = new EC2Client({ region: config.region, credentials });
    this.cloudwatch = new CloudWatchClient({
      region: config.region,
      credentials,
    });
  }

  async listResources(): Promise<CloudResourceRef[]> {
    const result = await this.ec2.send(new DescribeInstancesCommand({}));
    const resources: CloudResourceRef[] = [];
    for (const reservation of result.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        if (!instance.InstanceId) continue;
        const nameTag = instance.Tags?.find((tag) => tag.Key === 'Name')?.Value;
        resources.push({
          externalId: instance.InstanceId,
          name: nameTag ?? instance.InstanceId,
          provider: 'aws',
          region: this.region,
        });
      }
    }
    return resources;
  }

  async getMetrics(externalId: string): Promise<CloudMetricSample[]> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - METRIC_WINDOW_MS);

    const result = await this.cloudwatch.send(
      new GetMetricDataCommand({
        StartTime: startTime,
        EndTime: endTime,
        MetricDataQueries: [
          {
            Id: 'cpu',
            MetricStat: {
              Metric: {
                Namespace: 'AWS/EC2',
                MetricName: 'CPUUtilization',
                Dimensions: [{ Name: 'InstanceId', Value: externalId }],
              },
              Period: 300,
              Stat: 'Average',
            },
            ReturnData: true,
          },
        ],
      }),
    );

    const values = result.MetricDataResults?.[0]?.Values ?? [];
    if (values.length === 0) return [];
    // CloudWatch returns points newest-first for this query shape.
    return [
      { metricName: 'CPUUtilization', value: values[0], unit: 'Percent' },
    ];
  }
}
