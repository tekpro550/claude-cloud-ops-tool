import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { CreateTicketLinkDto } from './ticket-links.dto';

export interface LinkedTicket {
  linkId: string;
  relation: 'related' | 'parent' | 'child';
  ticketId: string;
  ticketNumber: number;
  subject: string;
  status: string;
}

/**
 * Ticket-to-ticket links. Stored as directed edges (see the migration);
 * 'child_of' from the caller's perspective is persisted as a parent_of edge in
 * the other direction so there is one canonical row per relationship.
 * list() resolves both directions back into related / parent / child buckets
 * from the given ticket's point of view.
 */
@Injectable()
export class TicketLinksService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(tenantId: string, ticketId: string, dto: CreateTicketLinkDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [other] = await queryRunner.query(
        `SELECT id FROM tickets WHERE ticket_number = $1`,
        [dto.toTicketNumber],
      );
      if (!other) {
        throw new NotFoundException(`Ticket #${dto.toTicketNumber} not found`);
      }
      if (other.id === ticketId) {
        throw new BadRequestException('A ticket cannot be linked to itself');
      }

      // Normalize direction so 'child_of' becomes a parent_of edge the other
      // way -- one canonical row shape (related | parent_of).
      let fromId = ticketId;
      let toId = other.id;
      let type: 'related' | 'parent_of' = 'related';
      if (dto.linkType === 'parent_of') {
        type = 'parent_of';
      } else if (dto.linkType === 'child_of') {
        type = 'parent_of';
        fromId = other.id;
        toId = ticketId;
      }

      const [row] = await queryRunner.query(
        `INSERT INTO ticket_links (tenant_id, from_ticket_id, to_ticket_id, link_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (from_ticket_id, to_ticket_id, link_type) DO NOTHING
         RETURNING *`,
        [tenantId, fromId, toId, type],
      );
      if (!row) {
        throw new BadRequestException('That link already exists');
      }
      return row;
    });
  }

  async list(tenantId: string, ticketId: string): Promise<LinkedTicket[]> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const rows = await queryRunner.query(
        `SELECT l.id AS link_id, l.link_type, l.from_ticket_id, l.to_ticket_id,
                t.id AS other_id, t.ticket_number, t.subject, t.status
         FROM ticket_links l
         JOIN tickets t
           ON t.id = CASE WHEN l.from_ticket_id = $1 THEN l.to_ticket_id ELSE l.from_ticket_id END
         WHERE l.from_ticket_id = $1 OR l.to_ticket_id = $1
         ORDER BY l.created_at`,
        [ticketId],
      );
      return rows.map(
        (r: {
          link_id: string;
          link_type: 'related' | 'parent_of';
          from_ticket_id: string;
          other_id: string;
          ticket_number: number;
          subject: string;
          status: string;
        }): LinkedTicket => {
          let relation: 'related' | 'parent' | 'child' = 'related';
          if (r.link_type === 'parent_of') {
            // from is the parent; if this ticket is the from side, the other is
            // its child, otherwise the other is this ticket's parent.
            relation = r.from_ticket_id === ticketId ? 'child' : 'parent';
          }
          return {
            linkId: r.link_id,
            relation,
            ticketId: r.other_id,
            ticketNumber: r.ticket_number,
            subject: r.subject,
            status: r.status,
          };
        },
      );
    });
  }

  async remove(tenantId: string, linkId: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM ticket_links WHERE id = $1 RETURNING id`,
        [linkId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Ticket link ${linkId} not found`);
      }
    });
  }
}
