import { IsString, IsUUID } from 'class-validator';

export class AddInternalTicketNoteDto {
  @IsUUID()
  tenantId: string;

  @IsString()
  body: string;
}
