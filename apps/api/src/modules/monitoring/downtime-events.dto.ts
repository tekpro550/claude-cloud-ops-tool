import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDowntimeEventDto {
  @IsUUID()
  resourceId: string;

  @IsOptional()
  @IsUUID()
  monitorId?: string;

  @IsString()
  reason: string;
}
