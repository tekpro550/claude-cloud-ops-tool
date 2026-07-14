import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const RESOURCE_TYPES = [
  'server',
  'cloud_account',
  'service',
  'website',
  'database',
  'other',
] as const;

export class CreateResourceDto {
  @IsString()
  name: string;

  @IsIn(RESOURCE_TYPES)
  resourceType: (typeof RESOURCE_TYPES)[number];

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsObject()
  tags?: Record<string, unknown>;
}

export class UpdateResourceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsObject()
  tags?: Record<string, unknown>;
}
