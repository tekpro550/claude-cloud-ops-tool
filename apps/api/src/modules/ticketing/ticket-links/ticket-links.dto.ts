import { IsIn, IsInt, Min } from 'class-validator';

const LINK_TYPES = ['related', 'parent_of', 'child_of'] as const;

export class CreateTicketLinkDto {
  // The other ticket, by its human-facing number (what the agent sees/types).
  @IsInt()
  @Min(1)
  toTicketNumber: number;

  // 'related' | 'parent_of' (this ticket is the parent) | 'child_of' (this
  // ticket is the child -- stored as a parent_of edge in the other direction).
  @IsIn(LINK_TYPES)
  linkType: (typeof LINK_TYPES)[number];
}
