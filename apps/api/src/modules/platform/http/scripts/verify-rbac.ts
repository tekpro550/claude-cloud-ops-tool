import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import * as request from 'supertest';
import { AppModule } from '../../../../app.module';
import { signJwt } from '../../auth/jwt';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`RBAC verification FAILED: ${message}`);
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

function tokenFor(
  tenantId: string,
  userId: string,
  email: string,
  role: string,
): string {
  return signJwt({ sub: userId, tenantId, email, kind: 'agent', role });
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `rbac-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['RBAC Verify', slug],
  );

  const makeUser = async (email: string, role: string) => {
    const {
      rows: [user],
    } = await migrator.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
      [tenant.id, email, email, role],
    );
    return user.id as string;
  };

  const adminId = await makeUser('admin@rbac.example', 'admin');
  const agentId = await makeUser('agent@rbac.example', 'agent');
  const viewerId = await makeUser('viewer@rbac.example', 'viewer');

  const adminToken = tokenFor(
    tenant.id,
    adminId,
    'admin@rbac.example',
    'admin',
  );
  const agentToken = tokenFor(
    tenant.id,
    agentId,
    'agent@rbac.example',
    'agent',
  );
  const viewerToken = tokenFor(
    tenant.id,
    viewerId,
    'viewer@rbac.example',
    'viewer',
  );

  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  const server = app.getHttpServer();

  const credBody = {
    provider: 'aws',
    label: 'RBAC test',
    config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
  };

  try {
    // --- Admin-only controller: cloud credentials ---
    const asAdmin = await request(server)
      .post('/api/v1/cloud-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(credBody);
    assert(
      asAdmin.status === 201 || asAdmin.status === 200,
      `an admin can create a cloud credential (got ${asAdmin.status})`,
    );

    const asAgent = await request(server)
      .post('/api/v1/cloud-credentials')
      .set('Authorization', `Bearer ${agentToken}`)
      .send(credBody);
    assert(
      asAgent.status === 403,
      `an agent is forbidden from creating a cloud credential (got ${asAgent.status})`,
    );

    const agentList = await request(server)
      .get('/api/v1/cloud-credentials')
      .set('Authorization', `Bearer ${agentToken}`);
    assert(
      agentList.status === 403,
      `an agent can't even list cloud credentials -- the whole controller is admin-only (got ${agentList.status})`,
    );

    // --- Mixed controller: agents list open, mutations admin-only ---
    const viewerAgentsList = await request(server)
      .get('/api/v1/agents')
      .set('Authorization', `Bearer ${viewerToken}`);
    assert(
      viewerAgentsList.status === 200,
      `any authenticated role can list agents for assignment dropdowns (got ${viewerAgentsList.status})`,
    );

    const agentCreatesAgent = await request(server)
      .post('/api/v1/agents')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ name: 'New Person', email: 'new@rbac.example' });
    assert(
      agentCreatesAgent.status === 403,
      `a non-admin agent can't create agents (got ${agentCreatesAgent.status})`,
    );

    // --- Mixed controller: cost settings readable, PATCH admin-only ---
    const agentReadsCost = await request(server)
      .get('/api/v1/tenant-cost-settings')
      .set('Authorization', `Bearer ${agentToken}`);
    assert(
      agentReadsCost.status === 200,
      `an agent can read tenant cost settings (got ${agentReadsCost.status})`,
    );
    const agentWritesCost = await request(server)
      .patch('/api/v1/tenant-cost-settings')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ financialYearStartMonth: 1 });
    assert(
      agentWritesCost.status === 403,
      `an agent can't change tenant cost settings (got ${agentWritesCost.status})`,
    );

    // --- Header-only request (no verified role) still passes by default,
    //     preserving the existing X-Tenant-Id pilot flow (RBAC_REQUIRE_AUTH
    //     defaults to false). ---
    const headerOnly = await request(server)
      .get('/api/v1/cloud-credentials')
      .set('X-Tenant-Id', tenant.id);
    assert(
      headerOnly.status === 200,
      `a header-only request is still allowed with RBAC_REQUIRE_AUTH unset (got ${headerOnly.status})`,
    );

    console.log('\nAll RBAC checks passed.');
  } finally {
    await migrator.query(`DELETE FROM cloud_credentials WHERE tenant_id = $1`, [
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
