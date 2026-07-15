import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

const NOTIFY_CHANNELS = ['email', 'whatsapp', 'voice', 'in_app'] as const;

export class CreateCostBudgetDto {
  @IsString()
  name: string;

  /** Omit for a tenant-wide budget spanning every connected account (section 3). */
  @IsOptional()
  @IsUUID()
  cloudCredentialId?: string;

  /** Omit for pace-only alerting with no hard cap -- compares against last month's actual spend instead. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyBudgetAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  paceWarningThresholdPct?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  paceCriticalThresholdPct?: number;

  @IsOptional()
  @IsIn(NOTIFY_CHANNELS)
  notifyChannel?: (typeof NOTIFY_CHANNELS)[number];

  @IsOptional()
  @IsString()
  notifyRecipient?: string;
}

export class UpdateCostBudgetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyBudgetAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  paceWarningThresholdPct?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  paceCriticalThresholdPct?: number;

  @IsOptional()
  @IsIn(NOTIFY_CHANNELS)
  notifyChannel?: (typeof NOTIFY_CHANNELS)[number];

  @IsOptional()
  @IsString()
  notifyRecipient?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
