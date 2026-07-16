import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  SendInput,
} from './notification-channel.interface';
import { postJson } from './post-json';

/**
 * Generic outbound webhook: POSTs the rendered subject/body plus the raw
 * notification payload as JSON to the `recipient` URL. Lets a tenant wire
 * alerts/escalations into anything that accepts a JSON POST (PagerDuty
 * events API, Opsgenie, a custom bridge) without a per-integration channel.
 */
@Injectable()
export class WebhookChannel implements NotificationChannel {
  readonly channel = 'webhook';
  private readonly logger = new Logger(WebhookChannel.name);

  async send(input: SendInput): Promise<void> {
    await postJson(input.recipient, {
      subject: input.message.subject,
      body: input.message.body,
      payload: input.payload,
    });
    this.logger.debug(`webhook posted to ${input.recipient}`);
  }
}
