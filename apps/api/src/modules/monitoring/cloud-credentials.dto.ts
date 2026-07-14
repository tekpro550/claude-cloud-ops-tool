import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

const CLOUD_PROVIDERS = ['aws', 'azure'] as const;

export class CreateCloudCredentialDto {
  @IsIn(CLOUD_PROVIDERS)
  provider: (typeof CLOUD_PROVIDERS)[number];

  @IsString()
  label: string;

  /** AWS: { region, accessKeyId, secretAccessKey }. Azure: { subscriptionId, tenantId, clientId, clientSecret }. */
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
