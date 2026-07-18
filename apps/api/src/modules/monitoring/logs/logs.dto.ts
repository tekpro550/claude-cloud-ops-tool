import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LOG_LEVELS } from './log-level';

export class CreateLogSourceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}

export class UpdateLogSourceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class IngestLogEntryDto {
  @IsOptional()
  @IsDateString()
  ts?: string;

  @IsOptional()
  @IsIn(LOG_LEVELS)
  level?: (typeof LOG_LEVELS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  message: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class IngestLogBatchDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => IngestLogEntryDto)
  entries: IngestLogEntryDto[];
}

export class CreateLogAlertRuleDto {
  @IsUUID()
  logSourceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  matchQuery?: string;

  @IsOptional()
  @IsIn(LOG_LEVELS)
  levelAtLeast?: (typeof LOG_LEVELS)[number];

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(86400)
  windowSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  threshold?: number;

  @IsOptional()
  @IsUUID()
  escalationPolicyId?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class UpdateLogAlertRuleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  matchQuery?: string;

  @IsOptional()
  @IsIn(LOG_LEVELS)
  levelAtLeast?: (typeof LOG_LEVELS)[number];

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(86400)
  windowSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  threshold?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
