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
};

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
