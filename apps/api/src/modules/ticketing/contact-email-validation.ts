/**
 * Basic sanity check, not spam filtering (section 5 of the Module 1 doc):
 * catches obviously malformed addresses (no @, no domain, embedded
 * whitespace) so the contacts list stays clean, matching Freshdesk's
 * "contacts that need action" pattern. A missing email isn't flagged --
 * only one that was actually provided and doesn't look like an email.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailValid(email: string | null | undefined): boolean {
  if (!email) return true;
  return EMAIL_PATTERN.test(email);
}
