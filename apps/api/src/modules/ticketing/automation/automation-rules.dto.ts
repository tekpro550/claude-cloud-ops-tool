import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

const TRIGGERS = ['ticket_created', 'ticket_updated', 'time_based'] as const;
const CONDITION_FIELDS = [
  'status',
  'priority',
  'source',
  'subject',
  'ticket_type_id',
  'group_id',
  'platform',
] as const;
const CONDITION_OPERATORS = ['equals', 'contains'] as const;
const ACTION_TYPES = [
  'set_status',
  'set_priority',
  'set_group',
  'set_agent',
  'set_platform',
  'add_note',
] as const;

export class AutomationConditionDto {
  @IsIn(CONDITION_FIELDS)
  field: (typeof CONDITION_FIELDS)[number];

  @IsIn(CONDITION_OPERATORS)
  operator: (typeof CONDITION_OPERATORS)[number];

  @IsString()
  value: string;
}

export class AutomationActionDto {
  @IsIn(ACTION_TYPES)
  type: (typeof ACTION_TYPES)[number];

  @IsString()
  value: string;
}

export class CreateAutomationRuleDto {
  @IsString()
  name: string;

  @IsIn(TRIGGERS)
  trigger: (typeof TRIGGERS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Required (and only meaningful) when trigger = 'time_based': how many
  // minutes after creation the rule fires, e.g. 1440 for "unresolved for
  // 24 hours". Validated against trigger in the service, not here --
  // class-validator conditional decorators would need the same field twice.
  @IsOptional()
  @IsInt()
  @Min(1)
  timeTriggerMinutes?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  conditions: AutomationConditionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions: AutomationActionDto[];
}

export class UpdateAutomationRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(TRIGGERS)
  trigger?: (typeof TRIGGERS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  timeTriggerMinutes?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  conditions?: AutomationConditionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions?: AutomationActionDto[];
}
