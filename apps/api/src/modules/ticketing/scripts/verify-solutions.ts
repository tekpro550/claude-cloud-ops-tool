import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { SolutionsService } from '../solutions.service';
import { SearchService } from '../search/search.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Solutions verification FAILED: ${message}`);
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

  const slug = `solutions-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Solutions Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const solutions = app.get(SolutionsService);
  const search = app.get(SearchService);

  try {
    const draft = await solutions.create(tenant.id, {
      title: 'How to reset your VPN client',
      body: 'Step 1: restart the client. Step 2: contact support if that fails.',
    });
    assert(
      draft.is_published === false,
      'a solution created without isPublished defaults to unpublished (draft)',
    );

    const published = await solutions.create(tenant.id, {
      title: 'Billing FAQ',
      body: 'Answers to common billing questions.',
      isPublished: true,
    });
    assert(
      published.is_published === true,
      'isPublished: true is honored on create',
    );

    const allSolutions = await solutions.list(tenant.id);
    assert(
      allSolutions.length === 2,
      'the admin list includes both draft and published solutions',
    );

    const updated = await solutions.update(tenant.id, draft.id, {
      isPublished: true,
    });
    assert(
      updated.is_published === true,
      'publishing a draft via update flips is_published',
    );

    let notFound: any = null;
    try {
      await solutions.get(tenant.id, '00000000-0000-4000-8000-000000000000');
    } catch (err) {
      notFound = err;
    }
    assert(
      notFound?.status === 404,
      'getting a nonexistent solution returns 404',
    );

    await solutions.remove(tenant.id, published.id);
    const afterRemove = await solutions.list(tenant.id);
    assert(
      afterRemove.length === 1 && afterRemove[0].id === draft.id,
      'removing a solution removes it from the list',
    );

    // ---- Global search integration ----
    const searchResults = await search.search(tenant.id, 'VPN client');
    assert(
      (searchResults.solutions as any[]).some((s: any) => s.id === draft.id),
      'global search (scope=all) surfaces a matching solution by title',
    );

    const scopedSearch = await search.search(tenant.id, 'VPN', 'solutions');
    assert(
      (scopedSearch.solutions as any[]).length === 1 &&
        scopedSearch.tickets.length === 0,
      'search with scope=solutions returns only solutions, no tickets',
    );

    const publishedOnlySearch = await search.search(
      tenant.id,
      'VPN',
      'solutions',
      true,
    );
    assert(
      (publishedOnlySearch.solutions as any[]).length === 1,
      'a published-only search still finds the now-published draft',
    );

    await solutions.update(tenant.id, draft.id, { isPublished: false });
    const publishedOnlyAfterUnpublish = await search.search(
      tenant.id,
      'VPN',
      'solutions',
      true,
    );
    assert(
      (publishedOnlyAfterUnpublish.solutions as any[]).length === 0,
      'a published-only search excludes an unpublished solution, even though an unrestricted search still finds it',
    );
    const unrestrictedAfterUnpublish = await search.search(
      tenant.id,
      'VPN',
      'solutions',
    );
    assert(
      (unrestrictedAfterUnpublish.solutions as any[]).length === 1,
      'the unrestricted (agent) search still finds the draft after unpublishing',
    );

    console.log('\nAll solutions checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM solutions WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
