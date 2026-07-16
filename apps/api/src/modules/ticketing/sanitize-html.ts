import * as sanitizeHtml from 'sanitize-html';

/**
 * Ticket message bodies became rich text (the composer now emits HTML), so
 * every body is a stored-XSS surface. This allowlist strips scripts, styles,
 * event handlers, and unknown tags/attributes, keeping only the formatting
 * the editor can produce. Applied on write in TicketsService.addMessage, so
 * what lands in the DB (and later renders in the agent thread, the portal,
 * and the outbound email) is already safe.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'h3',
    'h4',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
  },
  // Only safe URL schemes; javascript:/data: are dropped.
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    // Every link opens in a new tab and can't reach window.opener.
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    }),
  },
};

export function sanitizeTicketBody(body: string): string {
  return sanitizeHtml(body ?? '', OPTIONS);
}

/**
 * Plain-text fallback for channels/contexts that don't render HTML (e.g. the
 * text/plain MIME part of the outbound email). Strips all tags after
 * sanitizing, then collapses the whitespace HTML would have implied.
 */
export function htmlToPlainText(body: string): string {
  const withBreaks = (body ?? '')
    .replace(/<\/(p|div|h3|h4|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
