import { IsBoolean, IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;

export class CreateAlertRuleDto {
  @IsUUID()
  monitorId: string;

  @IsOptional()
  @IsObject()
  condition?: { statusIn?: string[] };

  @IsOptional()
  @IsIn(ALERT_SEVERITIES)
  severity?: (typeof ALERT_SEVERITIES)[number];

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class UpdateAlertRuleDto {
  @IsOptional()
  @IsObject()
  condition?: { statusIn?: string[] };

  @IsOptional()
  @IsIn(ALERT_SEVERITIES)
  severity?: (typeof ALERT_SEVERITIES)[number];

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
