import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FreshdeskConversation {
  id: number;
  body_text: string;
  incoming: boolean;
  private: boolean;
  user_id: number;
  created_at: string;
  attachments?: unknown[];
}

export interface FreshdeskTicket {
  id: number;
  subject: string;
  status: number;
  priority: number;
  type: string | null;
  group_id: number | null;
  responder_id: number | null;
  requester_id: number;
  requester?: { name: string; email: string } | null;
  created_at: string;
  updated_at: string;
  conversations?: FreshdeskConversation[];
  attachments?: unknown[];
}

export interface FreshdeskAgent {
  id: number;
  contact: { email: string; name: string };
}

export interface FreshdeskGroup {
  id: number;
  name: string;
}

/**
 * Thin wrapper over the Freshdesk API (section 9 of the Module 1 doc:
 * "Export path: pull tickets out via the Freshdesk API ... paginates through
 * the full ticket history"). There are no real Freshdesk credentials yet --
 * same "build now, credentials later" situation as email intake -- so this
 * is exercised against mocked payloads in
 * scripts/verify-freshdesk-mapping.ts, not against a live account. Every
 * method throws immediately if the required env vars aren't set, rather than
 * silently no-op'ing.
 */
@Injectable()
export class FreshdeskClient {
  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    const domain = this.config.get<string>('FRESHDESK_DOMAIN');
    if (!domain) throw new Error('FRESHDESK_DOMAIN is not configured');
    return `https://${domain}.freshdesk.com/api/v2`;
  }

  private get authHeader(): string {
    const apiKey = this.config.get<string>('FRESHDESK_API_KEY');
    if (!apiKey) throw new Error('FRESHDESK_API_KEY is not configured');
    return `Basic ${Buffer.from(`${apiKey}:X`).toString('base64')}`;
  }

  /** Freshdesk paginates at 100/page; yields one page at a time so a caller can migrate incrementally without holding the whole account in memory. */
  async *fetchAllTickets(): AsyncGenerator<FreshdeskTicket[]> {
    let page = 1;
    for (;;) {
      const res = await fetch(
        `${this.baseUrl}/tickets?include=conversations,requester&per_page=100&page=${page}`,
        {
          headers: { Authorization: this.authHeader },
        },
      );
      if (!res.ok) {
        throw new Error(
          `Freshdesk API error on page ${page}: ${res.status} ${res.statusText}`,
        );
      }
      const tickets = (await res.json()) as FreshdeskTicket[];
      if (tickets.length === 0) return;
      yield tickets;
      if (tickets.length < 100) return;
      page += 1;
    }
  }

  async fetchGroups(): Promise<FreshdeskGroup[]> {
    const res = await fetch(`${this.baseUrl}/groups`, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok)
      throw new Error(
        `Freshdesk API error fetching groups: ${res.status} ${res.statusText}`,
      );
    return res.json();
  }

  async fetchAgents(): Promise<FreshdeskAgent[]> {
    const res = await fetch(`${this.baseUrl}/agents`, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok)
      throw new Error(
        `Freshdesk API error fetching agents: ${res.status} ${res.statusText}`,
      );
    return res.json();
  }
}
