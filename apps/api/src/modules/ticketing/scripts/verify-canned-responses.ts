import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { CannedResponsesService } from '../canned-responses.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Canned responses verification FAILED: ${message}`);
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

  const slug = `canned-responses-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Canned Responses Verify', slug],
  );
  const {
    rows: [otherTenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Canned Responses Verify Other', `${slug}-other`],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const cannedResponses = app.get(CannedResponsesService);

  try {
    const created = await cannedResponses.create(tenant.id, {
      title: 'VPN reset',
      body: 'Your VPN access has been reset. Please try logging in again.',
    });
    assert(created.title === 'VPN reset', 'canned response created');

    await cannedResponses.create(otherTenant.id, {
      title: 'Other tenant response',
      body: 'Should not leak',
    });

    const list = await cannedResponses.list(tenant.id);
    assert(
      list.length === 1 && list[0].id === created.id,
      "list() only returns this tenant's canned responses",
    );

    const updated = await cannedResponses.update(tenant.id, created.id, {
      body: 'Updated body text',
    });
    assert(updated.body === 'Updated body text', 'update() changes the body');
    assert(
      updated.title === 'VPN reset',
      'update() leaves an unspecified field (title) untouched',
    );

    let crossTenantNotFound: any = null;
    try {
      await cannedResponses.update(otherTenant.id, created.id, {
        title: 'hijacked',
      });
    } catch (err) {
      crossTenantNotFound = err;
    }
    assert(
      crossTenantNotFound?.status === 404,
      "another tenant cannot update this tenant's canned response (404, RLS-enforced)",
    );

    await cannedResponses.remove(tenant.id, created.id);
    const listAfterDelete = await cannedResponses.list(tenant.id);
    assert(
      listAfterDelete.length === 0,
      'remove() deletes the canned response',
    );

    console.log('\nAll canned responses checks passed.');
  } finally {
    await migrator.query(
      `DELETE FROM canned_responses WHERE tenant_id IN ($1, $2)`,
      [tenant.id, otherTenant.id],
    );
    await migrator.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [
      tenant.id,
      otherTenant.id,
    ]);
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
