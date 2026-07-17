import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { ChatService } from '../chat.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Chat verification FAILED: ${message}`);
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

  const slug = `chat-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Chat Verify', slug],
  );
  const {
    rows: [user],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1, $2, 'Chat Agent', 'x', 'agent') RETURNING id`,
    [tenant.id, `chat-agent-${Date.now()}@example.com`],
  );
  const {
    rows: [agent],
  } = await migrator.query(
    `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [tenant.id, user.id],
  );
  // A second tenant proves RLS keeps sessions isolated.
  const {
    rows: [otherTenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Chat Verify Other', `${slug}-other`],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const chat = app.get(ChatService);

  try {
    const session = await chat.createSession(tenant.id, {
      visitorName: 'Jane Visitor',
    });
    assert(session.status === 'open', 'a new session starts open');
    assert(
      session.assigned_agent_id === null,
      'a new session is unassigned until an agent replies',
    );

    const openBefore = await chat.listSessions(tenant.id, 'open');
    assert(
      openBefore.some((s: any) => s.id === session.id),
      'the open-session filter lists the new session',
    );

    const t0 = new Date().toISOString();
    const visitorMsg = await chat.addMessage(tenant.id, session.id, {
      authorType: 'visitor',
      body: 'Hi, my dashboard is blank.',
    });
    assert(
      visitorMsg.author_type === 'visitor',
      'a visitor message is recorded',
    );

    const agentReply = await chat.addMessage(tenant.id, session.id, {
      authorType: 'agent',
      authorId: agent.id,
      body: 'Hello! Let me take a look.',
    });
    assert(agentReply.author_type === 'agent', 'an agent reply is recorded');

    const afterReply = await chat.getSession(tenant.id, session.id);
    assert(
      afterReply.assigned_agent_id === agent.id,
      'the first agent reply claims (assigns) the session',
    );

    // Delta polling: only messages after t0 come back, in order.
    const delta = await chat.listMessages(tenant.id, session.id, t0);
    assert(
      delta.length === 2 &&
        delta[0].id === visitorMsg.id &&
        delta[1].id === agentReply.id,
      'listMessages(since) returns only newer messages, oldest first',
    );

    // Close, then a visitor message reopens it.
    const closed = await chat.closeSession(tenant.id, session.id);
    assert(closed.status === 'closed', 'closeSession marks the session closed');

    await chat.addMessage(tenant.id, session.id, {
      authorType: 'visitor',
      body: 'Are you still there?',
    });
    const reopened = await chat.getSession(tenant.id, session.id);
    assert(
      reopened.status === 'open',
      'a visitor message reopens a closed session',
    );
    assert(
      reopened.assigned_agent_id === agent.id,
      'reopening keeps the previously-assigned agent',
    );

    // RLS isolation: the other tenant sees none of this.
    const otherView = await chat.listSessions(otherTenant.id);
    assert(
      !otherView.some((s: any) => s.id === session.id),
      'RLS hides one tenant’s chat sessions from another',
    );

    let notFound: any = null;
    try {
      await chat.getSession(otherTenant.id, session.id);
    } catch (err) {
      notFound = err;
    }
    assert(
      notFound?.status === 404,
      'fetching another tenant’s session by id returns 404 under RLS',
    );

    console.log('\nAll chat checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
      [tenant.id, otherTenant.id],
    ]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
