import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class AllocationQueryDto {
  @IsString()
  @MaxLength(256)
  tagKey: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
