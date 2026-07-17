import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { htmlToPlainText } from './sanitize-html';
import { CreateSolutionDto, UpdateSolutionDto } from './solutions.dto';

@Injectable()
export class SolutionsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Agent-facing knowledge base: every article, published or draft. Optional
  // case-insensitive search over title + body for the internal KB page.
  list(tenantId: string, search?: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) => {
      const term = search?.trim();
      if (term) {
        return queryRunner.query(
          `SELECT * FROM solutions
           WHERE title ILIKE $1 OR body ILIKE $1
           ORDER BY updated_at DESC`,
          [`%${term}%`],
        );
      }
      return queryRunner.query(
        `SELECT * FROM solutions ORDER BY updated_at DESC`,
      );
    });
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [solution] = await queryRunner.query(
        `SELECT * FROM solutions WHERE id = $1`,
        [id],
      );
      if (!solution) {
        throw new NotFoundException(`Solution ${id} not found`);
      }
      return solution;
    });
  }

  create(tenantId: string, dto: CreateSolutionDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [solution] = await queryRunner.query(
        `INSERT INTO solutions (tenant_id, title, body, is_published) VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, dto.title, dto.body, dto.isPublished ?? false],
      );
      return solution;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateSolutionDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM solutions WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Solution ${id} not found`);
      }

      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.title !== undefined) assign('title', dto.title);
      if (dto.body !== undefined) assign('body', dto.body);
      if (dto.isPublished !== undefined)
        assign('is_published', dto.isPublished);

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE solutions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM solutions WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Solution ${id} not found`);
      }
    });
  }

  /**
   * Seed a draft knowledge-base article from a resolved ticket: the ticket
   * subject becomes the title and the latest public agent reply (the answer
   * given to the customer) becomes the body. Created unpublished so it stays
   * internal-only until an agent reviews and publishes it. Idempotent — the
   * partial unique index on source_ticket_id means a re-resolve is a no-op, and
   * a ticket with no agent reply is skipped. Returns the created article, or
   * null when nothing was created.
   */
  createFromResolvedTicket(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM solutions WHERE source_ticket_id = $1`,
        [ticketId],
      );
      if (existing) return null;

      const [ticket] = await queryRunner.query(
        `SELECT subject FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) return null;

      const reply = await this.latestAgentReply(queryRunner, ticketId);
      if (!reply) return null;

      const body = htmlToPlainText(reply.body).trim();
      if (!body) return null;

      const [solution] = await queryRunner.query(
        `INSERT INTO solutions (tenant_id, title, body, is_published, source_ticket_id)
         VALUES ($1, $2, $3, false, $4)
         RETURNING *`,
        [tenantId, ticket.subject, body, ticketId],
      );
      return solution;
    });
  }

  private async latestAgentReply(
    queryRunner: QueryRunner,
    ticketId: string,
  ): Promise<{ body: string } | undefined> {
    const [reply] = await queryRunner.query(
      `SELECT body FROM ticket_messages
       WHERE ticket_id = $1 AND type = 'reply' AND author_type = 'agent'
       ORDER BY created_at DESC
       LIMIT 1`,
      [ticketId],
    );
    return reply;
  }
}
