import { IsIn, IsOptional, IsUUID } from 'class-validator';

const RECOMMENDATION_TYPES = ['rightsize', 'idle', 'terminate'] as const;
const RECOMMENDATION_STATUSES = [
  'open',
  'dismissed',
  'ticket_created',
  'resolved',
] as const;

export class ListRecommendationsQueryDto {
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsIn(RECOMMENDATION_STATUSES)
  status?: (typeof RECOMMENDATION_STATUSES)[number];

  @IsOptional()
  @IsIn(RECOMMENDATION_TYPES)
  type?: (typeof RECOMMENDATION_TYPES)[number];
}

// Only agent-driven transitions -- 'open' is set by the sweep and
// 'ticket_created' is set exclusively by POST .../create_ticket, so neither
// is a valid PATCH target here.
const PATCHABLE_STATUSES = ['dismissed', 'resolved'] as const;

export class UpdateRecommendationDto {
  @IsIn(PATCHABLE_STATUSES)
  status: (typeof PATCHABLE_STATUSES)[number];
}
