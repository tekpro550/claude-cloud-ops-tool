import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketSatisfactionService } from '../ticket-satisfaction.service';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket satisfaction verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'cloud_ops_tool',
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `ticket-satisfaction-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticket Satisfaction Verify', slug],
  );
  const {
    rows: [contactA],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Contact A', 'a@example.com'],
  );
  const {
    rows: [contactB],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Contact B', 'b@example.com'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const ticketsService = app.get(TicketsService);
  const satisfaction = app.get(TicketSatisfactionService);

  try {
    const ticket = await ticketsService.create(tenant.id, {
      subject: 'CSAT test ticket',
      contactId: contactA.id,
      source: 'api',
    });

    let tooEarly: any = null;
    try {
      await satisfaction.rate(tenant.id, contactA.id, ticket.id, {
        rating: 'happy',
      });
    } catch (err) {
      tooEarly = err;
    }
    assert(
      tooEarly?.status === 400,
      'rating an unresolved ticket is rejected (400)',
    );

    let wrongContact: any = null;
    await ticketsService.update(tenant.id, ticket.id, { status: 'resolved' });
    try {
      await satisfaction.rate(tenant.id, contactB.id, ticket.id, {
        rating: 'unhappy',
      });
    } catch (err) {
      wrongContact = err;
    }
    assert(
      wrongContact?.status === 404,
      "a contact rating another contact's ticket gets 404, not the real ticket",
    );

    const rating = await satisfaction.rate(tenant.id, contactA.id, ticket.id, {
      rating: 'happy',
      comment: 'Great support!',
    });
    assert(
      rating.rating === 'happy' && rating.comment === 'Great support!',
      'the ticket owner can rate their own resolved ticket',
    );

    let duplicate: any = null;
    try {
      await satisfaction.rate(tenant.id, contactA.id, ticket.id, {
        rating: 'neutral',
      });
    } catch (err) {
      duplicate = err;
    }
    assert(
      duplicate?.status === 409,
      'rating an already-rated ticket a second time is rejected (409)',
    );

    const fetched = await satisfaction.getForTicket(tenant.id, ticket.id);
    assert(
      fetched?.rating === 'happy',
      'getForTicket() returns the agent-facing rating for this ticket',
    );

    const unratedTicket = await ticketsService.create(tenant.id, {
      subject: 'Never rated',
      contactId: contactA.id,
      source: 'api',
    });
    const unratedFetch = await satisfaction.getForTicket(
      tenant.id,
      unratedTicket.id,
    );
    assert(
      unratedFetch === null,
      'getForTicket() returns null for a ticket with no rating yet',
    );

    const summary = await satisfaction.summary(tenant.id, 30);
    assert(
      summary.total === 1 && summary.happy === 1,
      `summary() counts the one rating (got total=${summary.total}, happy=${summary.happy})`,
    );
    assert(
      summary.happyPct === 100,
      `summary() computes 100% happy when the only rating is happy (got ${summary.happyPct})`,
    );

    console.log('\nAll ticket satisfaction checks passed.');
  } finally {
    await migrator.query(
      `DELETE FROM ticket_satisfaction_ratings WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
