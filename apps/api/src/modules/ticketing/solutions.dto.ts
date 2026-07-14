import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateSolutionDto {
  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateSolutionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
