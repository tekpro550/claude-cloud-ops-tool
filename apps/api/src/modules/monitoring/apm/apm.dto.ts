import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateApmIngestKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  service: string;
}

export class IngestSpanDto {
  @IsString()
  @IsNotEmpty()
  spanId: string;

  @IsOptional()
  @IsString()
  parentSpanId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  kind?: string;

  @IsInt()
  @Min(0)
  durationMs: number;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class IngestTraceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  transaction: string;

  @IsInt()
  @Min(0)
  durationMs: number;

  @IsOptional()
  @IsIn(['ok', 'error'])
  status?: 'ok' | 'error';

  @IsOptional()
  @IsString()
  ts?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestSpanDto)
  spans?: IngestSpanDto[];
}

export class IngestTraceBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestTraceDto)
  traces: IngestTraceDto[];
}
