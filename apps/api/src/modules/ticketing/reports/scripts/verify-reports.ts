import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { ReportsService } from '../reports.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Reports verification FAILED: ${message}`);
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
  const slug = `reports-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Reports Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Rep Contact', 'rep@example.com'],
  );
  const {
    rows: [user],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1, $2, 'Rep Agent', 'x', 'agent') RETURNING id`,
    [tenant.id, `rep-agent-${slug}@example.com`],
  );
  const {
    rows: [agent],
  } = await migrator.query(
    `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [tenant.id, user.id],
  );

  // Two tickets: one met both SLAs and is resolved; one breached first response.
  // created 3 days ago; first_response 30 min later (met a 60-min target);
  // resolved 2h later (met a 4h target).
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  let nextNumber = 1;
  const mkTicket = async (opts: {
    created: string;
    firstResponseDue: string;
    firstResponseAt: string | null;
    resolutionDue: string;
    resolvedAt: string | null;
    agentId: string | null;
  }) => {
    const {
      rows: [t],
    } = await migrator.query(
      `INSERT INTO tickets
         (tenant_id, ticket_number, subject, contact_id, status, priority, source,
          agent_id, first_response_due_at, first_response_at, resolution_due_at, resolved_at, created_at, updated_at)
       VALUES ($1, $10, 'R', $2, $3, 'medium', 'web_form',
          $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
      [
        tenant.id,
        contact.id,
        opts.resolvedAt ? 'resolved' : 'open',
        opts.agentId,
        opts.firstResponseDue,
        opts.firstResponseAt,
        opts.resolutionDue,
        opts.resolvedAt,
        opts.created,
        nextNumber++,
      ],
    );
    return t.id as string;
  };

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const reports = app.get(ReportsService);

  try {
    // Met ticket: created 3 days ago, responded in 30 min (target 60),
    // resolved in 2h (target 4h).
    const met = await mkTicket({
      created: at(-3 * DAY),
      firstResponseDue: at(-3 * DAY + 60 * MIN),
      firstResponseAt: at(-3 * DAY + 30 * MIN),
      resolutionDue: at(-3 * DAY + 4 * HOUR),
      resolvedAt: at(-3 * DAY + 2 * HOUR),
      agentId: agent.id,
    });
    // Breached first-response ticket: responded in 120 min against a 60-min
    // target, still unresolved.
    await mkTicket({
      created: at(-2 * DAY),
      firstResponseDue: at(-2 * DAY + 60 * MIN),
      firstResponseAt: at(-2 * DAY + 120 * MIN),
      resolutionDue: at(-2 * DAY + 4 * HOUR),
      resolvedAt: null,
      agentId: agent.id,
    });
    // A CSAT rating on the resolved ticket.
    await migrator.query(
      `INSERT INTO ticket_satisfaction_ratings (tenant_id, ticket_id, contact_id, rating, rated_at)
       VALUES ($1, $2, $3, 'happy', $4)`,
      [tenant.id, met, contact.id, at(-2 * DAY)],
    );

    const s = await reports.summary(tenant.id);

    assert(
      s.sla.firstResponse.total === 2 && s.sla.firstResponse.met === 1,
      'first-response SLA: 1 of 2 met',
    );
    assert(
      s.sla.firstResponse.pct === 50,
      'first-response attainment is 50%',
    );
    assert(
      s.sla.resolution.met === 1 && s.sla.resolution.total === 2,
      'resolution SLA: 1 of 2 met (the unresolved one counts against)',
    );
    assert(
      s.times.firstResponseMinutes.avg !== null &&
        s.times.firstResponseMinutes.avg > 0,
      'average first-response time is computed',
    );
    assert(
      s.csat.total === 1 && s.csat.score === 100 && s.csat.positivePct === 100,
      'CSAT: one happy rating → score 100 / 100% positive',
    );
    const agentRow = s.agents.find((a: { agent_id: string }) => a.agent_id === agent.id);
    assert(!!agentRow && agentRow.resolved === 1, 'agent performance shows 1 resolved');
    assert(
      s.volume.some((v: { created: number }) => v.created > 0),
      'volume-by-day has at least one day with created tickets',
    );

    console.log('\nAll reports checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_satisfaction_ratings WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_number_counters WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM agents WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [tenant.id]);
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
