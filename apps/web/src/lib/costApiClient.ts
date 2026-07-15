import { request } from "./apiClient";
import type {
  AccountCostSummary,
  CostBudget,
  CostLineItem,
  CostSavingsLogEntry,
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
