import { IsUUID } from 'class-validator';

export class LinkAlertTicketDto {
  @IsUUID()
  ticketId: string;
}
