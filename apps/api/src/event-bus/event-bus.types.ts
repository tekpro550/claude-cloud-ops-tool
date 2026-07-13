export interface DomainEventMessage {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PublishEventInput {
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
}
