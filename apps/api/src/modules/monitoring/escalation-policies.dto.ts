import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const NOTIFY_CHANNELS = [
  'email',
  'slack',
  'webhook',
  'whatsapp',
  'voice',
  'in_app',
] as const;

export class EscalationNotifyTargetDto {
  @IsIn(NOTIFY_CHANNELS)
  channel: (typeof NOTIFY_CHANNELS)[number];

  @IsString()
  recipient: string;
}

export class EscalationStepDto {
  @IsInt()
  @Min(0)
  delayMinutes: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EscalationNotifyTargetDto)
  notify: EscalationNotifyTargetDto[];
}

export class CreateEscalationPolicyDto {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EscalationStepDto)
  steps: EscalationStepDto[];
}

export class UpdateEscalationPolicyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EscalationStepDto)
  steps?: EscalationStepDto[];
}
