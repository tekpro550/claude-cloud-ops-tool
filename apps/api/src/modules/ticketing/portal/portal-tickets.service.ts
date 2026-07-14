import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { TicketsService } from '../tickets.service';
import { PortalSubmitTicketDto } from './portal-tickets.dto';

@Injectable()
export class PortalTicketsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tickets: TicketsService,
  ) {}

  /**
   * Open to guests, no login required, matching the doc. Matches an
   * existing contact by email or creates one -- the same find-or-create
   * TicketsService.create() already does for compose-outbound -- so a guest
   * submission and a later logged-in registration under the same email
   * resolve to one contact, not two.
   */
  async submit(tenantId: string, dto: PortalSubmitTicketDto) {
    const ticket = await this.tickets.create(tenantId, {
      subject: dto.subject,
      contact: { name: dto.name, email: dto.email },
      source: 'web_portal',
      priority: dto.priority,
    });
    await this.tickets.addMessage(tenantId, ticket.id, {
      type: 'reply',
      authorType: 'contact',
      authorId: ticket.contact_id,
      body: dto.description,
    });
    return this.tickets.get(tenantId, ticket.id);
  }

  listForContact(tenantId: string, contactId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM tickets WHERE contact_id = $1 ORDER BY ticket_number DESC`,
        [contactId],
      ),
    );
  }

  async getForContact(tenantId: string, contactId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT * FROM tickets WHERE id = $1 AND contact_id = $2`,
        [ticketId, contactId],
      );
      if (!ticket) {
        // Same 404 whether the ticket doesn't exist or just isn't this
        // contact's -- never confirm another contact's ticket id is real.
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }
      // Internal agent notes never go to the contact-facing thread.
      const messages = await queryRunner.query(
        `SELECT * FROM ticket_messages WHERE ticket_id = $1 AND type != 'note' ORDER BY created_at ASC`,
        [ticketId],
      );
      return { ...ticket, messages };
    });
  }
}
