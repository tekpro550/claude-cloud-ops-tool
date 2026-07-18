import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { ResourcesService } from '../../resources.service';
import { MonitorsService } from '../../monitors.service';
import { StatusPagesService } from '../status-pages.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Status pages verification FAILED: ${message}`);
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

  const slug = `status-pages-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Status Pages Verify', slug],
  );
  const tenantId = tenant.id as string;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const resources = app.get(ResourcesService);
  const monitors = app.get(MonitorsService);
  const statusPages = app.get(StatusPagesService);

  try {
    const resource = await resources.create(tenantId, {
      name: 'API server',
      resourceType: 'server',
    });
    const upMonitor = await monitors.create(tenantId, {
      resourceId: resource.id,
      name: 'API uptime',
      monitorType: 'http',
      config: { url: 'https://example.com' },
    });
    const downMonitor = await monitors.create(tenantId, {
      resourceId: resource.id,
      name: 'Background worker',
      monitorType: 'http',
      config: { url: 'https://example.com/worker' },
    });

    // Seed check history: upMonitor mostly up (9/10), downMonitor currently down.
    for (let i = 0; i < 9; i++) {
      await migrator.query(
        `INSERT INTO monitor_checks (tenant_id, monitor_id, status, checked_at) VALUES ($1, $2, 'up', now() - ($3 || ' minutes')::interval)`,
        [tenantId, upMonitor.id, i * 5],
      );
    }
    await migrator.query(
      `INSERT INTO monitor_checks (tenant_id, monitor_id, status, checked_at) VALUES ($1, $2, 'down', now())`,
      [tenantId, upMonitor.id],
    );
    await migrator.query(
      `INSERT INTO monitor_checks (tenant_id, monitor_id, status, checked_at) VALUES ($1, $2, 'down', now())`,
      [tenantId, downMonitor.id],
    );

    // ---- Admin CRUD ----
    const page = await statusPages.create(tenantId, {
      slug: `${slug}-page`,
      title: 'Acme Status',
      description: 'Live system status',
    });
    assert(page.is_public === true, 'a new status page defaults to public');

    await statusPages.addMonitor(tenantId, page.id, {
      monitorId: upMonitor.id,
      displayName: 'API',
      sortOrder: 0,
    });
    await statusPages.addMonitor(tenantId, page.id, {
      monitorId: downMonitor.id,
      displayName: 'Worker',
      sortOrder: 1,
    });

    const detail = await statusPages.get(tenantId, page.id);
    assert(
      detail.monitors.length === 2,
      'the admin detail view lists both linked monitors',
    );

    let duplicateLink: any = null;
    try {
      await statusPages.addMonitor(tenantId, page.id, {
        monitorId: upMonitor.id,
      });
    } catch (err) {
      duplicateLink = err;
    }
    assert(
      duplicateLink?.status === 400,
      'adding the same monitor to a page twice is rejected',
    );

    // ---- Public read ----
    const publicStatus = await statusPages.getPublicStatus(`${slug}-page`);
    assert(
      publicStatus.title === 'Acme Status' &&
        publicStatus.components.length === 2,
      'the public read returns the page title and both components',
    );
    const apiComponent = publicStatus.components.find(
      (c: any) => c.name === 'API',
    );
    const workerComponent = publicStatus.components.find(
      (c: any) => c.name === 'Worker',
    );
    assert(
      apiComponent?.status === 'down' &&
        apiComponent?.uptimePct !== null &&
        apiComponent.uptimePct > 80,
      'a component reports its latest status and a plausible rolling uptime percentage',
    );
    assert(
      workerComponent?.status === 'down',
      'a monitor with only down checks reports down',
    );
    assert(
      !('tenant_id' in publicStatus) &&
        !Object.prototype.hasOwnProperty.call(apiComponent, 'monitor_id'),
      'the public payload exposes no tenant_id or monitor_id fields',
    );
    // Explicit field whitelist check: the public payload must never leak
    // tenant_id, monitor ids/config, or any status_pages internal column.
    const publicJson = JSON.stringify(publicStatus);
    assert(
      !publicJson.includes(tenantId),
      'the public payload never includes the tenant id anywhere in its JSON',
    );

    let unknownSlug: any = null;
    try {
      await statusPages.getPublicStatus('does-not-exist');
    } catch (err) {
      unknownSlug = err;
    }
    assert(unknownSlug?.status === 404, 'an unknown slug 404s');

    // Making the page private hides it from the public endpoint.
    await statusPages.update(tenantId, page.id, { isPublic: false });
    let hiddenAfterUnpublish: any = null;
    try {
      await statusPages.getPublicStatus(`${slug}-page`);
    } catch (err) {
      hiddenAfterUnpublish = err;
    }
    assert(
      hiddenAfterUnpublish?.status === 404,
      'an unpublished (is_public=false) page 404s on the public endpoint',
    );
    await statusPages.update(tenantId, page.id, { isPublic: true });

    // ---- RLS: another tenant can't attach its monitor to this page, and can't see this page in its own list ----
    const {
      rows: [otherTenant],
    } = await migrator.query(
      `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
      ['Status Pages Verify Other', `${slug}-other`],
    );
    const otherResource = await resources.create(otherTenant.id, {
      name: 'Other tenant server',
      resourceType: 'server',
    });
    const otherMonitor = await monitors.create(otherTenant.id, {
      resourceId: otherResource.id,
      name: 'Other tenant monitor',
      monitorType: 'http',
      config: {},
    });
    let crossTenantLink: any = null;
    try {
      // Attempt to link another tenant's monitor onto this tenant's page,
      // scoped under THIS tenant's context -- the monitor lookup should find
      // nothing (RLS), so it's rejected as if the monitor doesn't exist.
      await statusPages.addMonitor(tenantId, page.id, {
        monitorId: otherMonitor.id,
      });
    } catch (err) {
      crossTenantLink = err;
    }
    assert(
      crossTenantLink?.status === 400,
      'a status page cannot link a monitor belonging to a different tenant',
    );

    const otherTenantList = await statusPages.list(otherTenant.id);
    assert(
      otherTenantList.length === 0,
      'RLS hides one tenant’s status pages from another in the admin list',
    );

    console.log('\nAll status pages checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE slug LIKE $1`, [
      `${slug}%`,
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
