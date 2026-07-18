export interface RenderedMessage {
  subject: string;
  body: string;
  /** Optional HTML rendering; the email channel sends it as the text/html part. */
  html?: string;
}

export interface NotificationAttachment {
  filename: string;
  contentType: string;
  /**
   * base64-encoded file content. Kept inline in the notifications.payload
   * jsonb column rather than a separate bytea column/object-storage row --
   * these are on-demand report exports (see cost/reporting/), generated
   * fresh each send, not long-lived files that need their own storage
   * lifecycle the way ticket attachments do.
   */
  base64: string;
}

export interface SendInput {
  recipient: string;
  message: RenderedMessage;
  payload: Record<string, unknown>;
  attachment?: NotificationAttachment;
}

export interface NotificationChannel {
  readonly channel: string;
  send(input: SendInput): Promise<void>;
}

/** WhatsApp (Tittu) and voice (Ginger) stay stubbed until Phase 2, per the architecture plan. */
export function stubChannel(channel: string): NotificationChannel {
  return {
    channel,
    async send() {
      throw new Error(
        `Notification channel "${channel}" is not implemented yet (Phase 2, per the architecture plan)`,
      );
    },
  };
}
