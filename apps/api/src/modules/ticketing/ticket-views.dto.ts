import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateTicketViewDto {
  @IsString()
  name: string;

  // Same shape as ListTicketsQueryDto's filter fields, saved verbatim as
  // JSON rather than re-validated field-by-field -- applying a saved view
  // just replays these through the existing GET /tickets query params, so
  // strict typing here would only duplicate that DTO's validation.
  @IsObject()
  filters: Record<string, unknown>;
}

export class UpdateTicketViewDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}
