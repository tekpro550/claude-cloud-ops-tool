import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';

export type SearchScope =
  | 'all'
  | 'tickets'
  | 'contacts'
  | 'companies'
  | 'solutions';

/**
 * Global search across tickets, contacts, companies, and solutions (the
 * knowledge base). The Module 1 doc's /search endpoint describes a
 * fine-grained scope enum (subject/description/notes_and_replies/
 * attachment_filenames) matching Freshdesk's search preferences -- that's
 * intentionally simplified to one scope per entity type here. Ticket matches
 * search the subject, the message thread, and attachment filenames in one
 * pass (covering the spirit of "notes_and_replies" and
 * "attachment_filenames" without the full per-field enum).
 */
@Injectable()
export class SearchService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  search(
    tenantId: string,
    q: string,
    scope: SearchScope = 'all',
    publishedSolutionsOnly = false,
  ) {
    const result: {
      tickets: unknown[];
      contacts: unknown[];
      companies: unknown[];
      solutions: unknown[];
    } = { tickets: [], contacts: [], companies: [], solutions: [] };

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
           LEFT JOIN ticket_attachments a ON a.ticket_id = t.id
           WHERE t.subject ILIKE $1 OR m.body ILIKE $1 OR a.file_name ILIKE $1
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

      if (scope === 'all' || scope === 'solutions') {
        const publishedClause = publishedSolutionsOnly
          ? 'AND is_published = true'
          : '';
        result.solutions = await queryRunner.query(
          `SELECT * FROM solutions WHERE (title ILIKE $1 OR body ILIKE $1) ${publishedClause} ORDER BY updated_at DESC LIMIT 25`,
          [like],
        );
      }

      return result;
    });
  }
}
