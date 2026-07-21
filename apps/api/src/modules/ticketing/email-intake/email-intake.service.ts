import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { TicketsService } from '../tickets.service';
import { processInboundEmail } from './process-inbound-email';

/**
 * Polls one IMAP mailbox for unseen messages and turns each into a ticket
 * via processInboundEmail(), matching the confirmed pilot mailbox
 * (cloud.support@tekprocloud.com) from section 8 of the Module 1 doc. One
 * mailbox maps to one tenant (EMAIL_INTAKE_TENANT_ID) -- multi-tenant inbox
 * routing isn't in scope here.
 *
 * Disabled by default (EMAIL_INTAKE_ENABLED unset/false): no IMAP
 * credentials exist yet, and this shouldn't try to connect to a mailbox
 * that isn't configured -- mirrors how the notification dispatcher's email
 * channel defaults to a network-free transport until a real one is wired up.
 */
@Injectable()
export class EmailIntakeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailIntakeService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly config: ConfigService,
    private readonly ticketsService: TicketsService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('EMAIL_INTAKE_ENABLED', 'false') !== 'true') {
      this.logger.log(
        'Email intake disabled (EMAIL_INTAKE_ENABLED is not "true"); not connecting to a mailbox.',
      );
      return;
    }

    const intervalMs = Number(
      this.config.get<string>('EMAIL_INTAKE_POLL_INTERVAL_MS', '30000'),
    );
    this.timer = setInterval(() => void this.pollOnce(), intervalMs);
    void this.pollOnce().catch((err) =>
      this.logger.error(`pollOnce tick failed: ${(err as Error).message}`),
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const tenantId = this.config.get<string>('EMAIL_INTAKE_TENANT_ID');
      if (!tenantId) {
        this.logger.error(
          'EMAIL_INTAKE_ENABLED is true but EMAIL_INTAKE_TENANT_ID is not set; skipping poll.',
        );
        return;
      }

      const client = new ImapFlow({
        host: this.config.getOrThrow<string>('IMAP_HOST'),
        port: Number(this.config.get<string>('IMAP_PORT', '993')),
        secure: this.config.get<string>('IMAP_SECURE', 'true') === 'true',
        auth: {
          user: this.config.getOrThrow<string>('IMAP_USER'),
          pass: this.config.getOrThrow<string>('IMAP_PASSWORD'),
        },
        logger: false,
      });

      try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
          for await (const message of client.fetch(
            { seen: false },
            { source: true, uid: true },
          )) {
            if (!message.source) continue;
            try {
              await processInboundEmail(
                this.ticketsService,
                tenantId,
                message.source,
              );
              await client.messageFlagsAdd([message.uid], ['\\Seen'], {
                uid: true,
              });
            } catch (err) {
              this.logger.error(
                `Failed to process inbound message uid=${message.uid}: ${(err as Error).message}`,
              );
            }
          }
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    } catch (err) {
      this.logger.error(`Email intake poll failed: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }
}
