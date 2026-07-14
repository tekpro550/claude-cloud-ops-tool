import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { CannedResponseFoldersService } from '../canned-response-folders.service';
import { CannedResponsesService } from '../canned-responses.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Canned response folders verification FAILED: ${message}`);
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

  const slug = `canned-folders-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Canned Folders Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const folders = app.get(CannedResponseFoldersService);
  const cannedResponses = app.get(CannedResponsesService);

  try {
    const folder = await folders.create(tenant.id, { name: 'Greetings' });
    assert(folder.name === 'Greetings', 'folder created');
    const list1 = await folders.list(tenant.id);
    assert(list1.length === 1, 'folder appears in list()');

    const response = await cannedResponses.create(tenant.id, {
      title: 'Hello',
      body: 'Hi there!',
      folderId: folder.id,
    });
    assert(
      response.folder_id === folder.id,
      'canned response created with folderId resolved',
    );

    const renamed = await folders.update(tenant.id, folder.id, {
      name: 'Greetings & Openers',
    });
    assert(
      renamed.name === 'Greetings & Openers',
      'folder renamed via update()',
    );

    await folders.remove(tenant.id, folder.id);
    const list2 = await folders.list(tenant.id);
    assert(list2.length === 0, 'remove() deletes the folder');

    const responseAfterFolderDelete = await cannedResponses.update(
      tenant.id,
      response.id,
      {},
    );
    assert(
      responseAfterFolderDelete.folder_id === null,
      'deleting a folder unlinks (not blocks) its canned responses',
    );

    let notFound: any = null;
    try {
      await folders.update(tenant.id, folder.id, { name: 'x' });
    } catch (err) {
      notFound = err;
    }
    assert(
      notFound?.status === 404,
      'updating an already-deleted folder returns 404',
    );

    console.log('\nAll canned response folder checks passed.');
  } finally {
    await migrator.query(`DELETE FROM canned_responses WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM canned_response_folders WHERE tenant_id = $1`,
      [tenant.id],
    );
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
