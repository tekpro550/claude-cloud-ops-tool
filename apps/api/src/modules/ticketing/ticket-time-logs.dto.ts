import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateTicketTimeLogDto {
  @IsInt()
  @Min(1)
  minutes: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;
}
