export type PlanTier = "internal" | "starter" | "growth" | "scale";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  planTier: PlanTier;
  financialYearStartMonth: number;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = "admin" | "agent" | "viewer";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export type ResourceType =
  | "server"
  | "cloud_account"
  | "service"
  | "website"
  | "database"
  | "other";

export interface Resource {
  id: string;
  tenantId: string;
  name: string;
  resourceType: ResourceType;
  groupName: string | null;
  externalRef: Record<string, unknown>;
  tags: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  tenantId: string;
  eventType: string;
  payload: TPayload;
  createdAt: string;
}

export type NotificationChannel = "email" | "whatsapp" | "voice" | "in_app";
export type NotificationStatus = "queued" | "sent" | "failed";

export interface Notification {
  id: string;
  tenantId: string;
  channel: NotificationChannel;
  recipient: string;
  templateName: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  createdAt: string;
  sentAt: string | null;
}
