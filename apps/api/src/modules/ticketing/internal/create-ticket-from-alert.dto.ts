import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export class CreateTicketFromAlertDto {
  @IsUUID()
  tenantId: string;

  @IsString()
  subject: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];
}
