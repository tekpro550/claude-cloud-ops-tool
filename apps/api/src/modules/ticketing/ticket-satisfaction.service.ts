import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { RateTicketDto } from './ticket-satisfaction.dto';

/**
 * CSAT surveys (Freshdesk Growth-plan gap): a contact rates their own
 * ticket once it's resolved/closed. One rating per ticket -- the unique
 * index on ticket_satisfaction_ratings.ticket_id is the actual guarantee,
 * the pre-check below just turns that into a clean 409 instead of a raw
 * constraint-violation error.
 */
@Injectable()
export class TicketSatisfactionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  rate(
    tenantId: string,
    contactId: string,
    ticketId: string,
    dto: RateTicketDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT id, status FROM tickets WHERE id = $1 AND contact_id = $2`,
        [ticketId, contactId],
      );
      if (!ticket) {
        // Same "don't confirm another contact's ticket id" reasoning as
        // PortalTicketsService.getForContact().
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }
      if (!['resolved', 'closed'].includes(ticket.status)) {
        throw new BadRequestException(
          'This ticket can only be rated once it is resolved',
        );
      }

      const [existing] = await queryRunner.query(
        `SELECT id FROM ticket_satisfaction_ratings WHERE ticket_id = $1`,
        [ticketId],
      );
      if (existing) {
        throw new ConflictException('This ticket has already been rated');
      }

      const [rating] = await queryRunner.query(
        `INSERT INTO ticket_satisfaction_ratings (tenant_id, ticket_id, contact_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [tenantId, ticketId, contactId, dto.rating, dto.comment ?? null],
      );
      return rating;
    });
  }

  getForTicket(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rating] = await queryRunner.query(
        `SELECT * FROM ticket_satisfaction_ratings WHERE ticket_id = $1`,
        [ticketId],
      );
      return rating ?? null;
    });
  }

  /** Tenant-wide CSAT score over the trailing window -- the dashboard's stat tile. */
  summary(tenantId: string, days: number) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE rating = 'happy')::int AS happy,
           count(*) FILTER (WHERE rating = 'neutral')::int AS neutral,
           count(*) FILTER (WHERE rating = 'unhappy')::int AS unhappy
         FROM ticket_satisfaction_ratings
         WHERE rated_at >= now() - ($1 || ' days')::interval`,
        [days],
      );
      const total = row.total as number;
      return {
        total,
        happy: row.happy,
        neutral: row.neutral,
        unhappy: row.unhappy,
        happyPct: total > 0 ? (row.happy / total) * 100 : null,
      };
    });
  }
}
