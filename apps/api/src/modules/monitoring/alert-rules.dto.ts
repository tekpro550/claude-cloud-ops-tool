import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { METRICS } from './metric-alert-rule';

const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
const RULE_KINDS = ['status', 'threshold', 'anomaly'] as const;
const COMPARATORS = ['gt', 'gte', 'lt', 'lte'] as const;

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

  @IsOptional()
  @IsUUID()
  escalationPolicyId?: string;

  @IsOptional()
  @IsIn(RULE_KINDS)
  ruleKind?: (typeof RULE_KINDS)[number];

  // Required together when ruleKind is 'threshold' or 'anomaly'; the service
  // does the final cross-field check (e.g. comparator/threshold only make
  // sense for 'threshold'), since that reads better next to the rule_kind
  // it depends on than a pile of @ValidateIf conditions here.
  @ValidateIf((o) => o.ruleKind === 'threshold' || o.ruleKind === 'anomaly')
  @IsIn(METRICS)
  metric?: (typeof METRICS)[number];

  @ValidateIf((o) => o.ruleKind === 'threshold')
  @IsIn(COMPARATORS)
  comparator?: (typeof COMPARATORS)[number];

  @ValidateIf((o) => o.ruleKind === 'threshold')
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  forConsecutive?: number;

  @ValidateIf((o) => o.ruleKind === 'anomaly')
  @IsNumber()
  @Min(0.1)
  anomalySensitivity?: number;
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

  @IsOptional()
  @IsUUID()
  escalationPolicyId?: string | null;

  @IsOptional()
  @IsIn(RULE_KINDS)
  ruleKind?: (typeof RULE_KINDS)[number];

  @IsOptional()
  @IsIn(METRICS)
  metric?: (typeof METRICS)[number];

  @IsOptional()
  @IsIn(COMPARATORS)
  comparator?: (typeof COMPARATORS)[number];

  @IsOptional()
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  forConsecutive?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  anomalySensitivity?: number;
}
