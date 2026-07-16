export interface RenderedMessage {
  subject: string;
  body: string;
  /** Optional HTML rendering; the email channel sends it as the text/html part. */
  html?: string;
}

export interface SendInput {
  recipient: string;
  message: RenderedMessage;
  payload: Record<string, unknown>;
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
