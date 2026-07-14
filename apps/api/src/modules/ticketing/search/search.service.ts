import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';

export type SearchScope = 'all' | 'tickets' | 'contacts' | 'companies';

/**
 * Global search across the entities that actually exist in this build
 * (tickets, contacts, companies). The Module 1 doc's /search endpoint also
 * covers "solutions" (a knowledge base) with a fine-grained scope enum
 * (subject/description/notes_and_replies/attachment_filenames) matching
 * Freshdesk's search preferences -- no knowledge base exists in this
 * codebase yet, so that part is intentionally left out rather than stubbed.
 * Ticket matches search both the subject and the message thread (so a
 * search hits replies/notes, not just the subject line), matching the
 * spirit of "notes_and_replies" scope without the full per-field enum.
 */
@Injectable()
export class SearchService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  search(tenantId: string, q: string, scope: SearchScope = 'all') {
    const result: {
      tickets: unknown[];
      contacts: unknown[];
      companies: unknown[];
    } = { tickets: [], contacts: [], companies: [] };

    // An empty query would otherwise match every row via ILIKE '%%'.
    if (!q.trim()) {
      return Promise.resolve(result);
    }

    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const like = `%${q}%`;

      if (scope === 'all' || scope === 'tickets') {
        result.tickets = await queryRunner.query(
          `SELECT DISTINCT t.* FROM tickets t
           LEFT JOIN ticket_messages m ON m.ticket_id = t.id
           WHERE t.subject ILIKE $1 OR m.body ILIKE $1
           ORDER BY t.created_at DESC
           LIMIT 25`,
          [like],
        );
      }

      if (scope === 'all' || scope === 'contacts') {
        result.contacts = await queryRunner.query(
          `SELECT * FROM contacts WHERE name ILIKE $1 OR email ILIKE $1 ORDER BY name LIMIT 25`,
          [like],
        );
      }

      if (scope === 'all' || scope === 'companies') {
        result.companies = await queryRunner.query(
          `SELECT * FROM companies WHERE name ILIKE $1 OR domain ILIKE $1 ORDER BY name LIMIT 25`,
          [like],
        );
      }

      return result;
    });
  }
}
