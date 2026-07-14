import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { InlineContactDto } from './create-ticket.dto';

export class ComposeOutboundDto {
  /** Either contactId (existing contact) or contact (quick "add contact" panel) must be provided. */
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InlineContactDto)
  contact?: InlineContactDto;

  @IsString()
  subject: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;
}
