import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannel,
  SendInput,
} from './notification-channel.interface';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Voice call via Twilio's REST API: places a call that reads the message aloud
 * with inline TwiML (<Say>). Default transport is 'log' (compose + log, no
 * network) like the SMS channel; set VOICE_TRANSPORT=twilio plus
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VOICE_FROM to place real
 * calls. `recipient` is the destination phone number.
 */
@Injectable()
export class VoiceChannel implements NotificationChannel {
  readonly channel = 'voice';
  private readonly logger = new Logger(VoiceChannel.name);
  private readonly transport: string;
  private readonly accountSid?: string;
  private readonly authToken?: string;
  private readonly from?: string;

  constructor(config: ConfigService) {
    this.transport = config.get<string>('VOICE_TRANSPORT', 'log');
    this.accountSid = config.get<string>('TWILIO_ACCOUNT_SID');
    this.authToken = config.get<string>('TWILIO_AUTH_TOKEN');
    this.from = config.get<string>('TWILIO_VOICE_FROM');
  }

  async send(input: SendInput): Promise<void> {
    const spoken = `${input.message.subject}. ${input.message.body}`.trim();

    if (
      this.transport !== 'twilio' ||
      !this.accountSid ||
      !this.authToken ||
      !this.from
    ) {
      this.logger.log(`[voice:log] to=${input.recipient} :: ${spoken}`);
      return;
    }

    const twiml = `<Response><Say>${escapeXml(spoken)}</Say></Response>`;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: input.recipient,
        From: this.from,
        Twiml: twiml,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Twilio voice call failed: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
    }
    this.logger.debug(`voice call placed to ${input.recipient}`);
  }
}
