import { IsOptional, IsString } from 'class-validator';

export class CreateCannedResponseDto {
  @IsString()
  title: string;

  @IsString()
  body: string;
}

export class UpdateCannedResponseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
