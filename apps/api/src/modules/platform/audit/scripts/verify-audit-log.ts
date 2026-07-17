import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { AuditLogService } from '../audit-log.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Audit log verification FAILED: ${message}`);
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
  const slug = `audit-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Audit Verify', slug],
  );
  const {
    rows: [user],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1, $2, $3, 'x', 'admin') RETURNING id`,
    [tenant.id, `admin-${slug}@example.com`, 'Ada Admin'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const audit = app.get(AuditLogService);

  try {
    await audit.record(tenant.id, {
      actorUserId: user.id,
      action: 'business_hours.update',
      entityType: 'business_hours',
      summary: 'Updated business hours',
      details: { timezone: 'Asia/Kolkata' },
    });
    // A second entry with no actor -- a system/headerless change still records.
    await audit.record(tenant.id, {
      action: 'tenant_cost_settings.update',
      entityType: 'tenant_cost_settings',
      summary: 'Updated cost settings',
    });

    const { items, total } = await audit.list(tenant.id);
    assert(total === 2, 'list returns both recorded entries');
    assert(
      (items[0] as { action: string }).action === 'tenant_cost_settings.update',
      'entries are returned newest-first',
    );
    const first = items[1] as {
      actor_label: string;
      actor_user_id: string;
      details: { timezone?: string };
      summary: string;
    };
    assert(
      first.actor_label === 'Ada Admin' && first.actor_user_id === user.id,
      'actor is resolved to a denormalized label from the user id',
    );
    assert(
      first.details.timezone === 'Asia/Kolkata',
      'structured details round-trip through the jsonb column',
    );
    const second = items[0] as { actor_user_id: string | null };
    assert(
      second.actor_user_id === null,
      'an actor-less (system) change still records with a null actor',
    );

    // record() must never throw, even on a bad tenant id -- it swallows and
    // logs so it can never break the underlying admin action.
    await audit.record('00000000-0000-0000-0000-000000000000', {
      action: 'noop',
      entityType: 'noop',
      summary: 'should not throw',
    });
    assert(true, 'record() swallows errors instead of throwing');

    console.log('\nAll audit log checks passed.');
  } finally {
    await migrator.query(`DELETE FROM admin_audit_log WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
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
