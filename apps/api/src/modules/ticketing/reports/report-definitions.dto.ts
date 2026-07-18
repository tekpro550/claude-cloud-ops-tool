import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  DATE_FIELDS,
  DIMENSIONS,
  FILTER_FIELDS,
  METRICS,
  ReportDateField,
  ReportDimension,
  ReportFilterField,
  ReportMetric,
} from './report-builder';

export class ReportFilterDto {
  @IsIn(FILTER_FIELDS)
  field: ReportFilterField;

  @IsString()
  value: string;
}

export class ReportDateRangeDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class ReportConfigDto {
  @IsIn(METRICS)
  metric: ReportMetric;

  @IsIn(DIMENSIONS)
  groupBy: ReportDimension;

  @IsOptional()
  @IsIn(DATE_FIELDS)
  dateField?: ReportDateField;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportDateRangeDto)
  dateRange?: ReportDateRangeDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportFilterDto)
  filters?: ReportFilterDto[];
}

export class CreateReportDefinitionDto {
  @IsString()
  name: string;

  @ValidateNested()
  @Type(() => ReportConfigDto)
  config: ReportConfigDto;
}
