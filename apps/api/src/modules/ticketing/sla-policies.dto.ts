import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateSlaPolicyDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(1)
  firstResponseTargetMinutes: number;

  @IsInt()
  @Min(1)
  resolutionTargetMinutes: number;

  @IsOptional()
  @IsBoolean()
  businessHoursOnly?: boolean;
}

export class UpdateSlaPolicyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  firstResponseTargetMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  resolutionTargetMinutes?: number;

  @IsOptional()
  @IsBoolean()
  businessHoursOnly?: boolean;
}
