import { IsIn, IsOptional, IsUUID } from 'class-validator';

const TICKET_STATUSES = [
  'new',
  'open',
  'pending',
  'resolved',
  'closed',
] as const;
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export class UpdateTicketDto {
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: (typeof TICKET_STATUSES)[number];

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsUUID()
  ticketTypeId?: string;
}
