import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const TICKET_STATUSES = [
  'new',
  'open',
  'pending',
  'resolved',
  'closed',
] as const;
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const TICKET_PLATFORMS = [
  'aws',
  'azure',
  'alibaba_cloud',
  'microsoft_365',
  'tittu_marketing_platform',
  'other',
] as const;

export class ListTicketsQueryDto {
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: (typeof TICKET_STATUSES)[number];

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];

  @IsOptional()
  @IsIn(TICKET_PLATFORMS)
  platform?: (typeof TICKET_PLATFORMS)[number];

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  // "Unassigned" quick view -- agent_id IS NULL can't be expressed via the
  // agentId filter above (an empty agentId means "no filter", not "no agent").
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unassigned?: boolean;

  // "Overdue" quick view -- same condition dashboard.service.ts already uses
  // for its overdueFirstResponse/overdueResolution counters, exposed here so
  // the ticket list can filter to exactly those tickets.
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @IsOptional()
  @IsISO8601()
  resolvedFrom?: string;

  @IsOptional()
  @IsISO8601()
  resolvedTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
