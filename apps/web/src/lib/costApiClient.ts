import { request } from "./apiClient";
import type {
  AccountCostSummary,
  Commitment,
  CommitmentCoverageResult,
  CommitmentKind,
  CommitmentPaymentOption,
  CommitmentRecommendation,
  CostBudget,
  CostDashboardSummary,
  CostLineItem,
  CostSavingsLogEntry,
  CostTrendPoint,
  NotifyChannel,
  RightsizingRecommendation,
  RightsizingRecommendationStatus,
  RightsizingRecommendationType,
  TenantCostSettings,
} from "../types/cost";

// ---- MSP rollup / drill-down ----

export function getAccountsSummary(tenantId: string): Promise<AccountCostSummary[]> {
  return request(tenantId, "GET", "/cost/accounts_summary");
}

export function getAccountSummary(tenantId: string, credentialId: string): Promise<AccountCostSummary> {
  return request(tenantId, "GET", `/cost/accounts/${credentialId}/summary`);
}

export interface LineItemFilters {
  startDate?: string;
  endDate?: string;
  service?: string;
  region?: string;
}

export function getAccountLineItems(
  tenantId: string,
  credentialId: string,
  filters: LineItemFilters = {},
): Promise<CostLineItem[]> {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.service) params.set("service", filters.service);
  if (filters.region) params.set("region", filters.region);
  const qs = params.toString();
  return request(tenantId, "GET", `/cost/accounts/${credentialId}/line_items${qs ? `?${qs}` : ""}`);
}

// ---- Cost budgets ----

export function listCostBudgets(tenantId: string): Promise<CostBudget[]> {
  return request(tenantId, "GET", "/cost-budgets");
}

export interface CostBudgetInput {
  name: string;
  cloudCredentialId?: string;
  monthlyBudgetAmount?: number;
  paceWarningThresholdPct?: number;
  paceCriticalThresholdPct?: number;
  notifyChannel?: NotifyChannel;
  notifyRecipient?: string;
}

export function createCostBudget(tenantId: string, input: CostBudgetInput): Promise<CostBudget> {
  return request(tenantId, "POST", "/cost-budgets", input);
}

export function updateCostBudget(
  tenantId: string,
  id: string,
  input: Partial<CostBudgetInput> & { isActive?: boolean },
): Promise<CostBudget> {
  return request(tenantId, "PATCH", `/cost-budgets/${id}`, input);
}

export function deleteCostBudget(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/cost-budgets/${id}`);
}

// ---- Rightsizing recommendations ----

export interface RecommendationFilters {
  resourceId?: string;
  status?: RightsizingRecommendationStatus;
  type?: RightsizingRecommendationType;
}

export function listRecommendations(
  tenantId: string,
  filters: RecommendationFilters = {},
): Promise<RightsizingRecommendation[]> {
  const params = new URLSearchParams();
  if (filters.resourceId) params.set("resourceId", filters.resourceId);
  if (filters.status) params.set("status", filters.status);
  if (filters.type) params.set("type", filters.type);
  const qs = params.toString();
  return request(tenantId, "GET", `/cost/recommendations${qs ? `?${qs}` : ""}`);
}

export function dismissRecommendation(tenantId: string, id: string): Promise<RightsizingRecommendation> {
  return request(tenantId, "PATCH", `/cost/recommendations/${id}`, { status: "dismissed" });
}

export function resolveRecommendation(tenantId: string, id: string): Promise<RightsizingRecommendation> {
  return request(tenantId, "PATCH", `/cost/recommendations/${id}`, { status: "resolved" });
}

export function createTicketFromRecommendation(
  tenantId: string,
  id: string,
): Promise<{ ticketId: string }> {
  return request(tenantId, "POST", `/cost/recommendations/${id}/create_ticket`);
}

// ---- Savings log ----

export interface SavingsLogFilters {
  resourceId?: string;
  ticketId?: string;
  status?: "logged" | "verified" | "not_materialized";
}

export function listSavingsLog(tenantId: string, filters: SavingsLogFilters = {}): Promise<CostSavingsLogEntry[]> {
  const params = new URLSearchParams();
  if (filters.resourceId) params.set("resourceId", filters.resourceId);
  if (filters.ticketId) params.set("ticketId", filters.ticketId);
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return request(tenantId, "GET", `/cost/savings_log${qs ? `?${qs}` : ""}`);
}

// ---- Tenant cost settings ----

export function getTenantCostSettings(tenantId: string): Promise<TenantCostSettings> {
  return request(tenantId, "GET", "/tenant-cost-settings");
}

export interface TenantCostSettingsInput {
  financialYearStartMonth?: number;
  costRateDisplay?: TenantCostSettings["cost_rate_display"];
}

export function updateTenantCostSettings(
  tenantId: string,
  input: TenantCostSettingsInput,
): Promise<TenantCostSettings> {
  return request(tenantId, "PATCH", "/tenant-cost-settings", input);
}

// ---- Cost dashboard ----

export function getCostDashboardSummary(tenantId: string): Promise<CostDashboardSummary> {
  return request(tenantId, "GET", "/cost/dashboard/summary");
}

export function getCostDashboardTrend(tenantId: string): Promise<CostTrendPoint[]> {
  return request(tenantId, "GET", "/cost/dashboard/trend");
}

// ---- Cost anomalies ----

export interface CostAnomaly {
  id: string;
  service: string;
  region: string | null;
  usage_date: string;
  baseline_amount: string;
  actual_amount: string;
  deviation_pct: string;
  reason_text: string;
  status: string;
  created_at: string;
}

export function listCostAnomalies(tenantId: string): Promise<CostAnomaly[]> {
  return request(tenantId, "GET", "/cost/anomalies");
}

export function dismissCostAnomaly(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "PATCH", `/cost/anomalies/${id}/dismiss`);
}

// ---- Tag-based cost allocation ----

export interface AllocationRow {
  tagValue: string;
  amount: number;
}

export interface CostAllocation {
  tagKey: string;
  total: number;
  rows: AllocationRow[];
}

export function listCostTagKeys(tenantId: string): Promise<string[]> {
  return request(tenantId, "GET", "/cost/allocation/tag-keys");
}

export function getCostAllocation(
  tenantId: string,
  tagKey: string,
): Promise<CostAllocation> {
  const qs = new URLSearchParams({ tagKey }).toString();
  return request(tenantId, "GET", `/cost/allocation?${qs}`);
}

// ---- Commitments (RI / Savings Plan) ----

export function listCommitments(tenantId: string): Promise<Commitment[]> {
  return request(tenantId, "GET", "/cost/commitments");
}

export interface CreateCommitmentInput {
  cloudCredentialId: string;
  kind: CommitmentKind;
  service: string;
  region?: string;
  termMonths: 12 | 36;
  paymentOption?: CommitmentPaymentOption;
  hourlyCommitment: number;
  startDate: string;
  endDate: string;
}

export function createCommitment(tenantId: string, input: CreateCommitmentInput): Promise<Commitment> {
  return request(tenantId, "POST", "/cost/commitments", input);
}

export function deleteCommitment(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/cost/commitments/${id}`);
}

export function getCommitmentCoverage(tenantId: string, id: string): Promise<CommitmentCoverageResult> {
  return request(tenantId, "GET", `/cost/commitments/${id}/coverage`);
}

export function listCommitmentRecommendations(tenantId: string): Promise<CommitmentRecommendation[]> {
  return request(tenantId, "GET", "/cost/commitments/recommendations");
}

export function dismissCommitmentRecommendation(tenantId: string, id: string): Promise<CommitmentRecommendation> {
  return request(tenantId, "PATCH", `/cost/commitments/recommendations/${id}/dismiss`);
}
