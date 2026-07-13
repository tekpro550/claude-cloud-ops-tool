export interface SlaTargets {
  first_response_target_minutes: number;
  resolution_target_minutes: number;
  business_hours_only: boolean;
}

export interface SlaDueDates {
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
}

/**
 * Anchored to the ticket's created_at, not "now" -- the SLA clock starts at
 * ticket creation regardless of when a policy happens to get attached or
 * changed, matching how helpdesk SLAs are normally understood.
 *
 * business_hours_only is intentionally not honored: there's no
 * business-hours-window configuration anywhere in the schema (section 3 of
 * the Module 1 doc only has the boolean flag on sla_policies, no actual
 * hours/days/timezone table), so a business-hours-aware calculation would
 * be guessing at hours nobody confirmed. Every policy gets flat 24/7 math
 * for now; this is the seam to extend once business hours are configurable.
 */
export function calculateDueDates(
  createdAt: Date,
  slaPolicy: SlaTargets | null,
): SlaDueDates {
  if (!slaPolicy) {
    return { firstResponseDueAt: null, resolutionDueAt: null };
  }

  return {
    firstResponseDueAt: new Date(
      createdAt.getTime() + slaPolicy.first_response_target_minutes * 60_000,
    ),
    resolutionDueAt: new Date(
      createdAt.getTime() + slaPolicy.resolution_target_minutes * 60_000,
    ),
  };
}
