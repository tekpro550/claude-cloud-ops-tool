// Mirrors the raw Postgres row shape the API returns as-is (snake_case),
// per apps/api/src/modules/ticketing/tickets.service.ts. No camelCase
// mapping layer exists yet on the backend, so the frontend consumes exactly
// what comes back over the wire rather than inventing one.

export type TicketStatus = "new" | "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketSource = "email" | "web_form" | "web_portal" | "agent_outbound" | "whatsapp" | "chat" | "api" | "alert";
export type TicketPlatform = "aws" | "azure" | "alibaba_cloud" | "microsoft_365" | "tittu_marketing_platform" | "other";

export interface Ticket {
  id: string;
  tenant_id: string;
  ticket_number: number;
  legacy_ticket_number: number | null;
  subject: string;
  contact_id: string;
  ticket_type_id: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  group_id: string | null;
  agent_id: string | null;
  platform: TicketPlatform | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  resource_id: string | null;
  sla_policy_id: string | null;
  first_response_due_at: string | null;
  first_response_at: string | null;
  resolution_due_at: string | null;
  resolved_at: string | null;
  source: TicketSource;
  source_detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketList {
  items: Ticket[];
  total: number;
}

export type TicketMessageType = "reply" | "note" | "forward";
export type TicketMessageAuthorType = "agent" | "contact" | "system";

export interface TicketMessage {
  id: string;
  tenant_id: string;
  ticket_id: string;
  type: TicketMessageType;
  author_type: TicketMessageAuthorType;
  author_id: string | null;
  body: string;
  cc: string[];
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string | null;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  contact_count: number;
}

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  email_valid: boolean;
}

export interface TicketActivity {
  id: string;
  ticket_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface TicketTimelineActivityItem {
  kind: "activity";
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
}

export interface TicketTimelineMessageItem {
  kind: "message";
  id: string;
  type: TicketMessageType;
  author_type: TicketMessageAuthorType;
  body: string;
  timestamp: string;
}

export interface TicketTimelineTimeLogItem {
  kind: "time_log";
  id: string;
  minutes: number;
  note: string | null;
  timestamp: string;
}

export type TicketTimelineItem = TicketTimelineActivityItem | TicketTimelineMessageItem | TicketTimelineTimeLogItem;

export interface Agent {
  id: string;
  name: string;
  email: string;
  is_active?: boolean;
  group_ids?: string[];
}

export interface TicketType {
  id: string;
  name: string;
  default_group_id: string | null;
  default_sla_policy_id: string | null;
}

export interface SlaPolicy {
  id: string;
  name: string;
  first_response_target_minutes: number;
  resolution_target_minutes: number;
  business_hours_only: boolean;
}

export type AutomationTrigger = "ticket_created" | "ticket_updated" | "time_based";
export type AutomationConditionField =
  | "status"
  | "priority"
  | "source"
  | "subject"
  | "ticket_type_id"
  | "group_id"
  | "platform"
  | "tags";
export type AutomationConditionOperator = "equals" | "contains";
export type AutomationActionType =
  | "set_status"
  | "set_priority"
  | "set_group"
  | "set_agent"
  | "set_platform"
  | "add_note"
  | "add_tag";

export interface AutomationCondition {
  field: AutomationConditionField;
  operator: AutomationConditionOperator;
  value: string;
}

export interface AutomationAction {
  type: AutomationActionType;
  value: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  position: number;
  is_active: boolean;
  time_trigger_minutes: number | null;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}

export interface Scenario {
  id: string;
  name: string;
  agent_id: string | null;
  actions: AutomationAction[];
}

export interface CannedResponseFolder {
  id: string;
  name: string;
  agent_id: string | null;
}

export interface CannedResponse {
  id: string;
  title: string;
  body: string;
  folder_id: string | null;
}

export interface TicketAttachment {
  id: string;
  ticket_message_id: string;
  file_name: string;
  file_size_bytes: string;
  created_at: string;
}

export interface Solution {
  id: string;
  title: string;
  body: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface TicketTodo {
  id: string;
  ticket_id: string;
  body: string;
  is_done: boolean;
  done_at: string | null;
  created_at: string;
}

export interface TicketTimeLog {
  id: string;
  ticket_id: string;
  agent_id: string | null;
  minutes: number;
  note: string | null;
  logged_at: string;
}

export interface TicketTimeLogList {
  items: TicketTimeLog[];
  totalMinutes: number;
}

export type SearchScope = "all" | "tickets" | "contacts" | "companies" | "solutions";

export interface SearchResults {
  tickets: Ticket[];
  contacts: Contact[];
  companies: Company[];
  solutions: Solution[];
}

export interface DashboardSummary {
  byStatus: Record<TicketStatus, number>;
  byPriority: Record<TicketPriority, number>;
  overdueFirstResponse: number;
  overdueResolution: number;
  unassigned: number;
  totalOpen: number;
}

export interface DashboardTrendPoint {
  date: string;
  created: number;
  resolved: number;
}

export interface SlaBucket {
  met: number;
  breached: number;
  pending: number;
}

export interface DashboardSlaSummary {
  totalWithSla: number;
  firstResponse: SlaBucket;
  resolution: SlaBucket;
}

export interface NeedsAttentionItem {
  id: string;
  severity: "warning" | "critical";
  message: string;
  count: number;
}

export interface DashboardActivityItem {
  kind: "ticket_created" | "activity" | "message";
  ticket_id: string;
  ticket_number: number;
  subject: string;
  timestamp: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  message_type: TicketMessageType | null;
  actor_name: string | null;
  actor_kind: "contact" | "agent" | "system";
}

export interface SetupStatusItem {
  key: string;
  label: string;
  count: number;
  complete: boolean;
}

export interface SetupStatus {
  items: SetupStatusItem[];
  complete: boolean;
  completedCount: number;
  totalCount: number;
}

export interface TicketPresenceEntry {
  agent_id: string;
  agent_name: string;
  is_typing: boolean;
  last_seen_at: string;
}

export interface TicketView {
  id: string;
  agent_id: string | null;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
}

export type TicketSatisfactionRating = "happy" | "neutral" | "unhappy";

export interface TicketSatisfactionEntry {
  id: string;
  ticket_id: string;
  contact_id: string;
  rating: TicketSatisfactionRating;
  comment: string | null;
  rated_at: string;
}

export interface CsatSummary {
  total: number;
  happy: number;
  neutral: number;
  unhappy: number;
  happyPct: number | null;
}
