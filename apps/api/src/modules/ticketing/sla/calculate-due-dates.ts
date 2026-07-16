import { addBusinessMinutes, BusinessHours } from './business-hours';

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
 * When a policy is business_hours_only and the tenant has business hours
 * configured, the clock only advances during the working window (see
 * addBusinessMinutes); otherwise it's flat 24/7 elapsed time. Passing no
 * businessHours falls back to 24/7 even for a business-hours policy, so an
 * unconfigured tenant degrades safely rather than throwing.
 */
export function calculateDueDates(
  createdAt: Date,
  slaPolicy: SlaTargets | null,
  businessHours?: BusinessHours | null,
): SlaDueDates {
  if (!slaPolicy) {
    return { firstResponseDueAt: null, resolutionDueAt: null };
  }

  const useBusinessHours = slaPolicy.business_hours_only && !!businessHours;

  const due = (targetMinutes: number): Date =>
    useBusinessHours
      ? addBusinessMinutes(createdAt, targetMinutes, businessHours!)
      : new Date(createdAt.getTime() + targetMinutes * 60_000);

  return {
    firstResponseDueAt: due(slaPolicy.first_response_target_minutes),
    resolutionDueAt: due(slaPolicy.resolution_target_minutes),
  };
}
