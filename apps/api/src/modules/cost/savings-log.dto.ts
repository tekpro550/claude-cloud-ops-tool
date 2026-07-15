import { IsIn, IsOptional, IsUUID } from 'class-validator';

const SAVINGS_STATUSES = ['logged', 'verified', 'not_materialized'] as const;

export class ListSavingsLogQueryDto {
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsUUID()
  ticketId?: string;

  @IsOptional()
  @IsIn(SAVINGS_STATUSES)
  status?: (typeof SAVINGS_STATUSES)[number];
}
