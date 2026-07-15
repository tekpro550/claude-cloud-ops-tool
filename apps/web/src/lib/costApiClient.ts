import { request } from "./apiClient";
import type { AccountCostSummary, CostBudget, CostLineItem, NotifyChannel } from "../types/cost";

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
