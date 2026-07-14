import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCannedResponseFolderDto {
  @IsString()
  name: string;

  /** Unset = shared/team folder; set = personal to one agent. */
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class UpdateCannedResponseFolderDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;
}
