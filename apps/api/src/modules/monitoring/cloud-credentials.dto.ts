import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

const CLOUD_PROVIDERS = [
  'aws',
  'azure',
  'gcp',
  'alibaba',
  'digitalocean',
  'oracle',
] as const;

export class CreateCloudCredentialDto {
  @IsIn(CLOUD_PROVIDERS)
  provider: (typeof CLOUD_PROVIDERS)[number];

  @IsString()
  label: string;

  /**
   * Provider-specific config. AWS: { region, accessKeyId, secretAccessKey }.
   * Azure: { subscriptionId, tenantId, clientId, clientSecret }.
   * GCP: { projectId, billingExportTable, accessToken }.
   * DigitalOcean: { apiToken }. Alibaba/Oracle: provider credentials.
   */
  @IsObject()
  config: Record<string, unknown>;
}

export class UpdateCloudCredentialDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
