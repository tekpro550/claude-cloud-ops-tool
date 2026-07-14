import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { AutomationActionDto } from './automation/automation-rules.dto';

export class CreateScenarioDto {
  @IsString()
  name: string;

  /** Unset = shared across all agents; set = personal to one agent. */
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions: AutomationActionDto[];
}

export class UpdateScenarioDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions?: AutomationActionDto[];
}

export class ApplyScenarioDto {
  @IsUUID()
  ticketId: string;
}
