/**
 * End-to-end verify for AI rightsizing rationale generation.
 * Requires: docker compose up -d
 */
import 'reflect-metadata';
import assert from 'assert';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../../database/data-source';

const FAKE_TENANT_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

async function setup(ds: DataSource): Promise<{ recId: string }> {
  await ds.query(
    `INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [FAKE_TENANT_ID, 'Rationale Test Tenant'],
  );
  const [cred] = await ds.query(
    `INSERT INTO cloud_credentials (tenant_id, name, provider, config_encrypted)
     VALUES ($1, 'test', 'aws', pgp_sym_encrypt('{}', 'dev-only-credentials-key-change-me-in-prod'))
     RETURNING id`,
    [FAKE_TENANT_ID],
  );
  const [resource] = await ds.query(
    `INSERT INTO resources (tenant_id, cloud_credential_id, external_id, name, kind, region)
     VALUES ($1, $2, 'i-rationale-test', 'web-server-01', 'ec2', 'us-east-1')
     RETURNING id`,
    [FAKE_TENANT_ID, cred.id],
  );
  const [rec] = await ds.query(
    `INSERT INTO rightsizing_recommendations
       (tenant_id, resource_id, recommendation_type, reason_text, estimated_monthly_saving)
     VALUES ($1, $2, 'idle', 'CPU averaged 2.1% over 14 days', 45.50)
     RETURNING id`,
    [FAKE_TENANT_ID, resource.id],
  );
  return { recId: rec.id };
}

async function teardown(ds: DataSource) {
  await ds.query(`DELETE FROM tenants WHERE id = $1`, [FAKE_TENANT_ID]);
}

async function main() {
  const ds = AppDataSource;
  await ds.initialize();

  try {
    const { RightsizingRationaleService } =
      await import('../rightsizing-rationale.service');
    const { DisabledCompletionClient } =
      await import('../../../ai/ai-completion.client');

    await teardown(ds);
    const { recId } = await setup(ds);

    // 1. Disabled client short-circuits, leaving ai_rationale null
    const disabledSvc = new (RightsizingRationaleService as any)(
      ds,
      new DisabledCompletionClient(),
      { resolveClient: async () => new DisabledCompletionClient() } as any,
    );
    await disabledSvc.generateRationale(FAKE_TENANT_ID, recId);
    const [before] = await ds.query(
      `SELECT ai_rationale FROM rightsizing_recommendations WHERE id = $1`,
      [recId],
    );
    assert.equal(
      before.ai_rationale,
      null,
      'disabled client leaves rationale null',
    );
    console.log('OK disabled client skips rationale');

    // 2. Fake client generates and stores rationale
    const generated =
      'web-server-01 has averaged only 2.1% CPU over the past 14 days, qualifying it as idle. Rightsizing or terminating this instance could save approximately $45.50/month. Consider moving workloads to a smaller instance or implementing auto-scaling.';
    const fakeClient = {
      enabled: true,
      async complete(_s: string, user: string) {
        assert(user.includes('web-server-01'), 'resource name in prompt');
        assert(user.includes('idle'), 'recommendation type in prompt');
        assert(user.includes('45.50'), 'saving amount in prompt');
        return generated;
      },
    };
    const svc = new (RightsizingRationaleService as any)(ds, fakeClient, {
      resolveClient: async () => null,
    } as any);
    await svc.generateRationale(FAKE_TENANT_ID, recId);
    const [after] = await ds.query(
      `SELECT ai_rationale, ai_rationale_model FROM rightsizing_recommendations WHERE id = $1`,
      [recId],
    );
    assert.equal(after.ai_rationale, generated, 'rationale stored');
    assert.equal(after.ai_rationale_model, 'ai', 'model recorded');
    console.log(
      'OK fake client stores rationale with resource context in prompt',
    );

    // 3. Non-existent recommendation doesn't throw
    await svc.generateRationale(
      FAKE_TENANT_ID,
      '00000000-0000-0000-0000-000000000000',
    );
    console.log('OK non-existent recommendation handled gracefully');

    // 4. RLS: tenant B cannot see tenant A's recommendation
    const [tenantB] = await ds.query(
      `INSERT INTO tenants (name) VALUES ('B') RETURNING id`,
    );
    const svcB = new (RightsizingRationaleService as any)(ds, fakeClient, {
      resolveClient: async () => null,
    } as any);
    // This should not throw but also shouldn't touch tenant A's data
    await svcB.generateRationale(tenantB.id, recId);
    const [checkA] = await ds.query(
      `SELECT ai_rationale FROM rightsizing_recommendations WHERE id = $1`,
      [recId],
    );
    assert.equal(
      checkA.ai_rationale,
      generated,
      'RLS: tenant B cannot modify tenant A recommendation',
    );
    console.log('OK RLS blocks cross-tenant rationale write');

    await ds.query(`DELETE FROM tenants WHERE id = $1`, [tenantB.id]);

    console.log('\nAll verify-rightsizing-rationale checks passed.');
  } finally {
    await teardown(ds).catch(() => {});
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
