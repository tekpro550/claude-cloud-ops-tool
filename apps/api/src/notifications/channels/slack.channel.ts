import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  SendInput,
} from './notification-channel.interface';
import { postJson } from './post-json';

/**
 * Posts to a Slack incoming webhook. The notification's `recipient` is the
 * webhook URL (per channel + workspace), configured on the escalation step
 * or alert rule. The rendered subject becomes the bold lead line, the body
 * follows -- Slack renders the `text` field as mrkdwn.
 */
@Injectable()
export class SlackChannel implements NotificationChannel {
  readonly channel = 'slack';
  private readonly logger = new Logger(SlackChannel.name);

  async send(input: SendInput): Promise<void> {
    await postJson(input.recipient, {
      text: `*${input.message.subject}*\n${input.message.body}`,
    });
    this.logger.debug(`slack message posted to ${input.recipient}`);
  }
}
