import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const TICKET_SOURCES = [
  'email',
  'web_form',
  'whatsapp',
  'chat',
  'api',
  'alert',
] as const;
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export class InlineContactDto {
  @IsString()
  name: string;

  @IsString()
  email: string;
}

export class CreateTicketDto {
  @IsString()
  subject: string;

  /** Either contactId or contact must be provided (enforced in the service, not here). */
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InlineContactDto)
  contact?: InlineContactDto;

  @IsIn(TICKET_SOURCES)
  source: (typeof TICKET_SOURCES)[number];

  @IsOptional()
  @IsUUID()
  ticketTypeId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];
}
