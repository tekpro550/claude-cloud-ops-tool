import { Logger } from '@nestjs/common';
import { ParsedMail, simpleParser } from 'mailparser';
import { TicketsService } from '../tickets.service';

const logger = new Logger('EmailIntake');

// Matches a ticket reference tag like "[Ticket #42]" in a subject line, the
// standard helpdesk convention for correlating a reply to the ticket it
// belongs to. Nothing sends that tag on outbound replies yet (there's no
// outbound-reply-email feature built), so this mostly matters once that
// exists or for manually testing the threading path -- but it costs nothing
// to have now and avoids every reply-all becoming a duplicate ticket later.
const TICKET_REFERENCE_RE = /\[Ticket #(\d+)\]/i;

export interface ProcessInboundEmailResult {
  ticketId: string;
  ticketNumber: number;
  created: boolean;
}

/**
 * Turns one raw RFC822 email into a ticket (or a reply on an existing one).
 * Pure with respect to IMAP -- takes a raw message buffer, not a live
 * connection -- so it can run against a synthetic .eml in tests without a
 * real mailbox, and the IMAP polling loop that calls this stays thin.
 */
export async function processInboundEmail(
  ticketsService: TicketsService,
  tenantId: string,
  rawEmail: Buffer | string,
): Promise<ProcessInboundEmailResult> {
  const parsed = await simpleParser(rawEmail);

  const fromAddress = Array.isArray(parsed.from?.value)
    ? parsed.from?.value[0]
    : undefined;
  if (!fromAddress?.address) {
    throw new Error(
      'Inbound email has no From address; cannot resolve a contact',
    );
  }

  const subject = parsed.subject ?? '(no subject)';
  const body = extractBody(parsed);

  const referencedTicketNumber = extractReferencedTicketNumber(subject);
  if (referencedTicketNumber !== null) {
    const existing = await ticketsService.findByTicketNumber(
      tenantId,
      referencedTicketNumber,
    );
    if (existing) {
      await ticketsService.addMessage(tenantId, existing.id, {
        type: 'reply',
        authorType: 'contact',
        body,
      });
      logger.log(
        `Threaded inbound email onto existing ticket #${existing.ticket_number} (${existing.id})`,
      );
      return {
        ticketId: existing.id,
        ticketNumber: existing.ticket_number,
        created: false,
      };
    }
  }

  const ticket = await ticketsService.create(tenantId, {
    subject,
    contact: {
      name: fromAddress.name || fromAddress.address,
      email: fromAddress.address,
    },
    source: 'email',
  });

  await ticketsService.addMessage(tenantId, ticket.id, {
    type: 'reply',
    authorType: 'contact',
    authorId: ticket.contact_id,
    body,
  });

  logger.log(
    `Created ticket #${ticket.ticket_number} (${ticket.id}) from inbound email`,
  );
  return {
    ticketId: ticket.id,
    ticketNumber: ticket.ticket_number,
    created: true,
  };
}

function extractBody(parsed: ParsedMail): string {
  if (parsed.text) return parsed.text.trim();
  if (typeof parsed.html === 'string') return stripHtml(parsed.html);
  return '(empty message body)';
}

/**
 * Best-effort fallback for html-only emails. Worth swapping for a real
 * HTML-to-text library if/when that turns out to matter in practice --
 * most mail clients send a text/plain part alongside HTML, which is what
 * extractBody prefers.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractReferencedTicketNumber(subject: string): number | null {
  const match = TICKET_REFERENCE_RE.exec(subject);
  return match ? Number(match[1]) : null;
}
