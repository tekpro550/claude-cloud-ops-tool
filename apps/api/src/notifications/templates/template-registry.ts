import { RenderedMessage } from '../channels/notification-channel.interface';

type TemplateRenderer = (payload: Record<string, unknown>) => RenderedMessage;

/**
 * Sprint 0 seeds one template to prove the mechanism. Real templates (with
 * $VARIABLE substitution per section 7.2 of the architecture plan) land
 * alongside the modules that need them.
 */
const templates: Record<string, TemplateRenderer> = {
  'sprint0.test_email': (payload) => ({
    subject: 'Cloud Ops Tool test notification',
    body: `This is a Sprint 0 test notification. Message: ${payload.message ?? ''}`,
  }),
  'ticket.overdue': (payload) => {
    const label =
      payload.overdueType === 'resolution' ? 'Resolution' : 'First response';
    return {
      subject: `Ticket #${payload.ticketNumber} is ${label.toLowerCase()} overdue`,
      body: `${label} SLA breached for ticket #${payload.ticketNumber}: "${payload.subject}". It was due at ${payload.dueAt}.`,
    };
  },
  // An agent's public reply, delivered to the requesting contact. The
  // "[Ticket #N]" tag in the subject is load-bearing: process-inbound-email
  // matches exactly that pattern to thread the contact's response back onto
  // the same ticket instead of opening a new one.
  'ticket.reply': (payload) => {
    const agentName = payload.agentName ? String(payload.agentName) : 'Support';
    const bodyHtml = payload.bodyHtml ? String(payload.bodyHtml) : undefined;
    return {
      subject: `[Ticket #${payload.ticketNumber}] ${payload.subject}`,
      body: `${payload.body}\n\n— ${agentName}`,
      // bodyHtml is the agent's already-sanitized rich-text reply; wrap it
      // with the same signature line the plain-text part carries.
      html: bodyHtml
        ? `${bodyHtml}<p>— ${escapeHtml(agentName)}</p>`
        : undefined,
    };
  },
  // EscalationSweepService (Module 2) does its own notification_templates
  // lookup and $VARIABLE substitution before enqueueing, so this renderer is
  // just a passthrough for the already-rendered subject/body -- the DB-backed
  // template system lives alongside this code-based one, not instead of it.
  'monitoring.escalation': (payload) => ({
    subject: String(payload.subject ?? 'Alert escalation'),
    body: String(payload.body ?? ''),
  }),
  // CostPaceCheckService (Module 3) does its own notification_templates
  // lookup and $VARIABLE substitution before enqueueing, same passthrough
  // pattern as 'monitoring.escalation' above.
  'cost.pace_alert': (payload) => ({
    subject: String(payload.subject ?? 'Cost alert'),
    body: String(payload.body ?? ''),
  }),
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderTemplate(
  templateName: string,
  payload: Record<string, unknown>,
): RenderedMessage {
  const renderer = templates[templateName];
  if (!renderer) {
    throw new Error(`Unknown notification template: "${templateName}"`);
  }
  return renderer(payload);
}
