import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class MergeTicketsDto {
  // The duplicate tickets to fold into the primary (the :id in the route).
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  sourceTicketIds: string[];
}
