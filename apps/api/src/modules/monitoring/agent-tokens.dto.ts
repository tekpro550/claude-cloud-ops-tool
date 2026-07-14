import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAgentTokenDto {
  @IsUUID()
  resourceId: string;

  @IsString()
  label: string;
}

export class UpdateAgentTokenDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
