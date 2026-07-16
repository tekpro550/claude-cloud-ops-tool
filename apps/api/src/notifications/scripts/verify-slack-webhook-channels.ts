import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../app.module';
import { NotificationsService } from '../notifications.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Slack/webhook channel verification FAILED: ${message}`);
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

interface Received {
  path: string;
  body: any;
}

async function waitForStatus(
  migrator: Client,
  notificationId: string,
  timeoutMs = 10000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await migrator.query(
      `SELECT status FROM notifications WHERE id = $1`,
      [notificationId],
    );
    if (rows[0] && rows[0].status !== 'queued') return rows[0].status;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for notification ${notificationId}`);
}

async function main() {
  const received: Received[] = [];
  // Local receiver: 127.0.0.1 is in the proxy's no_proxy list, so these
  // POSTs stay on-box and never touch the network.
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.url === '/fail') {
        res.writeHead(500);
        res.end('boom');
        return;
      }
      received.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') });
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const migrator = migratorClient();
  await migrator.connect();
  const slug = `slack-webhook-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Slack Webhook Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const notifications = app.get(NotificationsService);

  try {
    // --- Slack ---
    const { id: slackId } = await notifications.enqueue({
      tenantId: tenant.id,
      channel: 'slack',
      recipient: `${base}/slack`,
      templateName: 'monitoring.escalation',
      payload: { subject: 'CPU critical', body: 'web-01 at 98%' },
    });
    const slackStatus = await waitForStatus(migrator, slackId);
    assert(
      slackStatus === 'sent',
      'a slack notification is dispatched (status=sent)',
    );
    const slackHit = received.find((r) => r.path === '/slack');
    assert(!!slackHit, 'the slack incoming-webhook URL received a POST');
    assert(
      slackHit!.body.text === '*CPU critical*\nweb-01 at 98%',
      'slack payload uses the mrkdwn { text: "*subject*\\nbody" } shape',
    );

    // --- Generic webhook ---
    const { id: hookId } = await notifications.enqueue({
      tenantId: tenant.id,
      channel: 'webhook',
      recipient: `${base}/hook`,
      templateName: 'monitoring.escalation',
      payload: { subject: 'Disk warning', body: 'db-02 at 85%' },
    });
    const hookStatus = await waitForStatus(migrator, hookId);
    assert(
      hookStatus === 'sent',
      'a webhook notification is dispatched (status=sent)',
    );
    const hookHit = received.find((r) => r.path === '/hook');
    assert(!!hookHit, 'the webhook URL received a POST');
    assert(
      hookHit!.body.subject === 'Disk warning' &&
        hookHit!.body.body === 'db-02 at 85%',
      'webhook payload carries the rendered subject and body',
    );

    // --- Delivery failure surfaces as status=failed, not silent success ---
    const { id: failId } = await notifications.enqueue({
      tenantId: tenant.id,
      channel: 'webhook',
      recipient: `${base}/fail`,
      templateName: 'monitoring.escalation',
      payload: { subject: 'nope', body: 'nope' },
    });
    const failStatus = await waitForStatus(migrator, failId);
    assert(
      failStatus === 'failed',
      'a non-2xx webhook response marks the notification failed (not silently sent)',
    );

    console.log('\nAll slack/webhook channel checks passed.');
  } finally {
    await migrator.query(`DELETE FROM notifications WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
    await app.close();
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
