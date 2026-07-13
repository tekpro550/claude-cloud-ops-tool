import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  NotificationChannel,
  SendInput,
} from './notification-channel.interface';

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly channel = 'email';
  private readonly logger = new Logger(EmailChannel.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>(
      'SMTP_FROM',
      'notifications@cloud-ops-tool.local',
    );

    if (config.get<string>('EMAIL_TRANSPORT', 'json') === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: config.get<string>('SMTP_HOST'),
        port: config.get<number>('SMTP_PORT', 587),
        secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
        auth: config.get<string>('SMTP_USER')
          ? {
              user: config.get<string>('SMTP_USER'),
              pass: config.get<string>('SMTP_PASSWORD'),
            }
          : undefined,
      });
    } else {
      // Composes and validates a real MIME message without touching the network.
      // Swap EMAIL_TRANSPORT=smtp once a real provider (SendGrid/SES, per the
      // architecture plan) is configured; the send() call site doesn't change.
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
    }
  }

  async send(input: SendInput): Promise<void> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: input.recipient,
      subject: input.message.subject,
      text: input.message.body,
    });
    this.logger.debug(
      `email dispatched to ${input.recipient}: ${JSON.stringify(info)}`,
    );
  }
}
