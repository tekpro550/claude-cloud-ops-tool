import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannel,
  SendInput,
} from './notification-channel.interface';

/**
 * SMS via Twilio's REST API. Default transport is 'log' — it composes and logs
 * the message without hitting the network, the same "no external call until
 * configured" stance as EMAIL_TRANSPORT=json. Set SMS_TRANSPORT=twilio plus
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM to actually send.
 * The notification's `recipient` is the destination phone number.
 */
@Injectable()
export class SmsChannel implements NotificationChannel {
  readonly channel = 'sms';
  private readonly logger = new Logger(SmsChannel.name);
  private readonly transport: string;
  private readonly accountSid?: string;
  private readonly authToken?: string;
  private readonly from?: string;

  constructor(config: ConfigService) {
    this.transport = config.get<string>('SMS_TRANSPORT', 'log');
    this.accountSid = config.get<string>('TWILIO_ACCOUNT_SID');
    this.authToken = config.get<string>('TWILIO_AUTH_TOKEN');
    this.from = config.get<string>('TWILIO_SMS_FROM');
  }

  async send(input: SendInput): Promise<void> {
    const text = `${input.message.subject}\n${input.message.body}`.trim();

    if (
      this.transport !== 'twilio' ||
      !this.accountSid ||
      !this.authToken ||
      !this.from
    ) {
      this.logger.log(`[sms:log] to=${input.recipient} :: ${text}`);
      return;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: input.recipient,
        From: this.from,
        Body: text,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Twilio SMS send failed: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
    }
    this.logger.debug(`sms sent to ${input.recipient}`);
  }
}
