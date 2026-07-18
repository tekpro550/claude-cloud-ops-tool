import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { REPORT_KINDS } from './report-generator.service';

const FORMATS = ['csv', 'pdf'] as const;
const CADENCES = ['daily', 'weekly', 'monthly'] as const;

export class CreateScheduledReportDto {
  @IsString()
  name: string;

  @IsIn(REPORT_KINDS)
  reportKind: (typeof REPORT_KINDS)[number];

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsIn(FORMATS)
  format: (typeof FORMATS)[number];

  @IsIn(CADENCES)
  cadence: (typeof CADENCES)[number];

  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  recipients: string[];
}
