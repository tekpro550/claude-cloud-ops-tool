import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

const MONITOR_TYPES = [
  'http',
  'ping',
  'port',
  'dns',
  'ssl',
  'server_agent',
  'cloud_metric',
  'synthetic',
] as const;

export class CreateMonitorDto {
  @IsUUID()
  resourceId: string;

  @IsString()
  name: string;

  @IsIn(MONITOR_TYPES)
  monitorType: (typeof MONITOR_TYPES)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(10)
  intervalSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  consecutiveFailuresToAlert?: number;

  // Distinct probe locations that must be failing before an alert opens.
  @IsOptional()
  @IsInt()
  @Min(1)
  minFailingLocations?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class UpdateMonitorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(10)
  intervalSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  consecutiveFailuresToAlert?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
