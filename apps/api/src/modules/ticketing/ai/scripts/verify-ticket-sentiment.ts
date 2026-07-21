/**
 * End-to-end verify for ticket sentiment detection.
 * Requires: docker compose up -d (Postgres + Redis)
 */
import 'reflect-metadata';
import * as assert from 'assert';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../../../database/data-source';

const FAKE_TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

async function setup(
  ds: DataSource,
): Promise<{ ticketId: string; contactId: string }> {
  await ds.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, 'sentiment-verify') ON CONFLICT (id) DO NOTHING`,
    [FAKE_TENANT_ID, 'Sentiment Test Tenant'],
  );
  await ds.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role)
     VALUES ($1, $2, $3, 'x', 'Test Agent', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [
      'aaaaaaaa-0000-0000-0001-000000000001',
      FAKE_TENANT_ID,
      'sent-agent@test.com',
    ],
  );
  await ds.query(
    `INSERT INTO agents (id, tenant_id, user_id)
     VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [
      'aaaaaaaa-0000-0000-0002-000000000001',
      FAKE_TENANT_ID,
      'aaaaaaaa-0000-0000-0001-000000000001',
    ],
  );
  await ds.query(
    `INSERT INTO contacts (id, tenant_id, name, email)
     VALUES ($1, $2, 'Test Contact', 'sent-contact@test.com')
     ON CONFLICT (id) DO NOTHING`,
    ['aaaaaaaa-0000-0000-0003-000000000001', FAKE_TENANT_ID],
  );
  const [ticket] = await ds.query(
    `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, source, priority)
     VALUES ($1, 9901, 'Our service is DOWN and we lose thousands per minute!!!', $2, 'web_form', 'urgent')
     RETURNING id`,
    [FAKE_TENANT_ID, 'aaaaaaaa-0000-0000-0003-000000000001'],
  );
  await ds.query(
    `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body)
     VALUES ($1, $2, 'reply', 'contact', 'This is completely unacceptable. Fix it NOW or I am cancelling!')`,
    [FAKE_TENANT_ID, ticket.id],
  );
  return {
    ticketId: ticket.id,
    contactId: 'aaaaaaaa-0000-0000-0003-000000000001',
  };
}

async function teardown(ds: DataSource) {
  await ds.query(`DELETE FROM tenants WHERE id = $1`, [FAKE_TENANT_ID]);
}

async function main() {
  const ds = AppDataSource;
  await ds.initialize();

  try {
    // Import after DataSource is initialized
    const { TicketSentimentService } =
      await import('../ticket-sentiment.service');
    const { DisabledCompletionClient } =
      await import('../../../../ai/ai-completion.client');

    await teardown(ds);
    const { ticketId } = await setup(ds);

    // 1. Disabled client short-circuits immediately — no error
    const disabledSvc = new (TicketSentimentService as any)(
      ds,
      new DisabledCompletionClient(),
      {
        resolveClient: async () => new DisabledCompletionClient(),
      } as any,
    );
    await disabledSvc.detectSentiment(FAKE_TENANT_ID, ticketId);
    const [noupdate] = await ds.query(
      `SELECT sentiment FROM tickets WHERE id = $1`,
      [ticketId],
    );
    assert.equal(
      noupdate.sentiment,
      null,
      'disabled client leaves sentiment null',
    );
    console.log('OK disabled client skips detection');

    // 2. Fake client returning negative sentiment updates the ticket
    let callCount = 0;
    const fakeClient = {
      enabled: true,
      async complete(_s: string, _u: string) {
        callCount++;
        return JSON.stringify({
          sentiment: 'at_risk',
          score: 0.95,
          rationale: 'churn signals',
        });
      },
    };
    const svc = new (TicketSentimentService as any)(ds, fakeClient, {
      resolveClient: async () => null,
    } as any);
    await svc.detectSentiment(FAKE_TENANT_ID, ticketId);
    const [updated] = await ds.query(
      `SELECT sentiment, sentiment_score FROM tickets WHERE id = $1`,
      [ticketId],
    );
    assert.equal(updated.sentiment, 'at_risk', 'sentiment updated to at_risk');
    assert(Number(updated.sentiment_score) > 0.9, 'score stored');
    assert.equal(callCount, 1, 'AI called once');
    console.log('OK fake client stores at_risk sentiment');

    // 3. Debounce: second call within gap period skips AI
    await svc.detectSentiment(FAKE_TENANT_ID, ticketId);
    assert.equal(callCount, 1, 'debounce prevents second AI call');
    console.log('OK debounce prevents rapid re-calls');

    // 4. Allowlist gating: bad sentiment value is ignored
    const badFakeClient = {
      enabled: true,
      async complete() {
        return JSON.stringify({ sentiment: 'INJECTED_SQL', score: 1 });
      },
    };
    const badSvc = new (TicketSentimentService as any)(ds, badFakeClient, {
      resolveClient: async () => null,
    } as any);
    // Clear debounce by nulling sentiment_updated_at
    await ds.query(
      `UPDATE tickets SET sentiment_updated_at = null WHERE id = $1`,
      [ticketId],
    );
    await badSvc.detectSentiment(FAKE_TENANT_ID, ticketId);
    const [afterBad] = await ds.query(
      `SELECT sentiment FROM tickets WHERE id = $1`,
      [ticketId],
    );
    assert.equal(
      afterBad.sentiment,
      'at_risk',
      'bad sentiment output ignored, value unchanged',
    );
    console.log('OK allowlist gates bad sentiment values');

    // 5. Non-existent ticket doesn't throw
    await svc.detectSentiment(
      FAKE_TENANT_ID,
      '00000000-0000-0000-0000-000000000000',
    );
    console.log('OK non-existent ticket handled gracefully');

    console.log('\nAll verify-ticket-sentiment checks passed.');
  } finally {
    await teardown(ds).catch(() => {});
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
