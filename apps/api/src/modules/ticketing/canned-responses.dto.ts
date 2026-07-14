import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCannedResponseDto {
  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;
}

export class UpdateCannedResponseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;
}
