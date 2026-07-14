import { IsOptional, IsString } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  domain?: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  domain?: string;
}
