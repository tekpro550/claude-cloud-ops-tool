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

export type NotifyChannel = "email" | "whatsapp" | "voice" | "in_app";

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
