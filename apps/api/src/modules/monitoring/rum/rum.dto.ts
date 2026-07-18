import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const RUM_METRICS = ['lcp', 'fcp', 'ttfb', 'js_error'] as const;

export class CreateRumAppKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  appName: string;
}

export class IngestRumEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  page: string;

  @IsIn(RUM_METRICS)
  metric: (typeof RUM_METRICS)[number];

  @IsNumber()
  value: number;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  ts?: string;
}

export class RumCollectDto {
  @IsString()
  @IsNotEmpty()
  appKey: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestRumEventDto)
  events: IngestRumEventDto[];
}
