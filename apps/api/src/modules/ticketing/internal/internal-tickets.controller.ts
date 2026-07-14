import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalApiKeyGuard } from '../../platform/http/internal-api-key.guard';
import { TicketsService } from '../tickets.service';
import { AddInternalTicketNoteDto } from './add-internal-ticket-note.dto';
import { CreateTicketFromAlertDto } from './create-ticket-from-alert.dto';

const ALERT_CONTACT = {
  name: 'System Monitoring',
  email: 'alerts@system.internal',
};

/**
 * The contract Module 2 (Monitoring) integrates against once it exists (per
 * section 7 of the architecture plan's Sprint 4 scope): turns a monitoring
 * alert into a ticket. Alerts don't have a human requester, so every
 * alert-created ticket is attributed to a synthetic per-tenant "System
 * Monitoring" contact (upserted by email the same way email intake upserts a
 * contact from a From header) rather than requiring a schema change to make
 * contact_id nullable.
 */
@UseGuards(InternalApiKeyGuard)
@Controller('internal/tickets')
export class InternalTicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post('from_alert')
  async fromAlert(@Body() dto: CreateTicketFromAlertDto) {
    const ticket = await this.ticketsService.create(dto.tenantId, {
      subject: dto.subject,
      contact: ALERT_CONTACT,
      source: 'alert',
      resourceId: dto.resourceId,
      priority: dto.priority,
    });

    await this.ticketsService.addMessage(dto.tenantId, ticket.id, {
      type: 'note',
      authorType: 'system',
      body: dto.description,
    });

    return ticket;
  }

  /**
   * Module 2's "repeats become notes, not new tickets" idempotency rule
   * (see the Sprint 2 scope section 5): once an alert has a linked ticket,
   * a continuing or recovered condition posts here instead of calling
   * from_alert again.
   */
  @Post(':ticketId/notes')
  addNote(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: AddInternalTicketNoteDto,
  ) {
    return this.ticketsService.addMessage(dto.tenantId, ticketId, {
      type: 'note',
      authorType: 'system',
      body: dto.body,
    });
  }
}
