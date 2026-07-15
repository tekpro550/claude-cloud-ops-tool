import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class ListLineItemsQueryDto {
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  region?: string;
}
