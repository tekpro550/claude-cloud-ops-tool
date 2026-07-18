export type CloudProvider = "aws" | "azure";

export interface CostTrendPoint {
  month: string;
  total: number;
}

export interface CostBreakdownItem {
  service?: string;
  region?: string;
  total: number;
}

export interface AccountCostSummary {
  cloudCredentialId: string;
  provider: CloudProvider;
  label: string;
  lastPolledAt: string | null;
  previousMonthTotal: number | null;
  mtdSpend: number;
  mtdPctChange: number | null;
  forecast: number | null;
  forecastPctChange: number | null;
  insightText: string | null;
  trend: CostTrendPoint[];
  topServices: CostBreakdownItem[];
  topRegions: CostBreakdownItem[];
}

export interface CostLineItem {
  id: string;
  service: string;
  region: string | null;
  usage_date: string;
  amount: number;
  currency: string;
}

export type NotifyChannel = "email" | "sms" | "whatsapp" | "voice" | "in_app";

export interface CostBudget {
  id: string;
  name: string;
  cloud_credential_id: string | null;
  monthly_budget_amount: number | null;
  pace_warning_threshold_pct: number;
  pace_critical_threshold_pct: number;
  notify_channel: NotifyChannel | null;
  notify_recipient: string | null;
  is_active: boolean;
  created_at: string;
}

export type RightsizingRecommendationType = "rightsize" | "idle" | "terminate";
export type RightsizingRecommendationStatus = "open" | "dismissed" | "ticket_created" | "resolved";

export interface RightsizingRecommendation {
  id: string;
  resource_id: string;
  recommendation_type: RightsizingRecommendationType;
  reason_text: string;
  estimated_monthly_saving: number | null;
  status: RightsizingRecommendationStatus;
  ticket_id: string | null;
  created_at: string;
  updated_at: string;
}

export type CostSavingsStatus = "logged" | "verified" | "not_materialized";

export interface CostSavingsLogEntry {
  id: string;
  resource_id: string;
  recommendation_id: string | null;
  ticket_id: string | null;
  expected_monthly_saving: number;
  actual_monthly_saving: number | null;
  status: CostSavingsStatus;
  logged_at: string;
  verified_at: string | null;
}

export type CostRateDisplay = "list_price" | "negotiated";

export interface TenantCostSettings {
  id: string;
  financial_year_start_month: number;
  cost_rate_display: CostRateDisplay;
}

export interface CostDashboardSummary {
  mtdSpend: number;
  previousMonthTotal: number | null;
  forecast: number | null;
  forecastPctChange: number | null;
  connectedAccounts: number;
  openBudgetAlerts: number;
  openRecommendations: number;
}

export type CommitmentKind = "reserved_instance" | "savings_plan";
export type CommitmentPaymentOption = "no_upfront" | "partial_upfront" | "all_upfront";

export interface Commitment {
  id: string;
  cloud_credential_id: string;
  kind: CommitmentKind;
  service: string;
  region: string | null;
  term_months: 12 | 36;
  payment_option: CommitmentPaymentOption;
  hourly_commitment: number;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface CommitmentCoverage {
  totalSpend: number;
  coveredSpend: number;
  coveragePct: number;
}

export interface CommitmentUtilization {
  committedTotal: number;
  usedTotal: number;
  utilizationPct: number;
  wastedAmount: number;
}

export interface CommitmentCoverageResult {
  commitment: Commitment;
  coverage: CommitmentCoverage | null;
  utilization: CommitmentUtilization | null;
  reason: string | null;
}

export interface CommitmentRecommendation {
  id: string;
  cloud_credential_id: string;
  kind: CommitmentKind;
  service: string;
  region: string | null;
  recommended_hourly_commitment: number;
  estimated_monthly_savings: number;
  break_even_months: number | null;
  based_on_days: number;
  status: "open" | "dismissed";
  generated_at: string;
}
