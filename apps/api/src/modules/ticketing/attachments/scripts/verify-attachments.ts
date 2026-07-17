import 'dotenv/config';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import * as request from 'supertest';
import { AppModule } from '../../../../app.module';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Attachments verification FAILED: ${message}`);
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

  // Isolated storage dir per run so this script never touches (or races)
  // whatever the running dev server's ATTACHMENTS_STORAGE_DIR points at.
  const storageDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'attachments-verify-'),
  );
  process.env.ATTACHMENTS_STORAGE_DIR = storageDir;

  const slug = `attachments-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Attachments Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, 'Requester', 'req@example.com') RETURNING id`,
    [tenant.id],
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

  try {
    const createTicketRes = await request(server)
      .post('/api/v1/tickets')
      .set('X-Tenant-Id', tenant.id)
      .send({
        subject: 'Needs a screenshot',
        contactId: contact.id,
        source: 'web_form',
      });
    const ticketId = createTicketRes.body.id;

    const messageRes = await request(server)
      .post(`/api/v1/tickets/${ticketId}/messages`)
      .set('X-Tenant-Id', tenant.id)
      .send({
        type: 'reply',
        authorType: 'contact',
        authorId: contact.id,
        body: 'Here is a screenshot.',
      });
    const messageId = messageRes.body.id;

    const noFileRes = await request(server)
      .post(`/api/v1/tickets/${ticketId}/messages/${messageId}/attachments`)
      .set('X-Tenant-Id', tenant.id);
    assert(
      noFileRes.status === 400,
      'uploading with no file attached is rejected with 400',
    );

    const fileContents = Buffer.from('fake png bytes for testing');
    const uploadRes = await request(server)
      .post(`/api/v1/tickets/${ticketId}/messages/${messageId}/attachments`)
      .set('X-Tenant-Id', tenant.id)
      .attach('file', fileContents, 'screenshot.png');
    assert(
      uploadRes.status === 201,
      `uploading a file to a real message succeeds (status=${uploadRes.status})`,
    );
    assert(
      uploadRes.body.file_name === 'screenshot.png' &&
        uploadRes.body.file_size_bytes === String(fileContents.length),
      'the attachment row records the original filename and size',
    );
    assert(
      uploadRes.body.ticket_id === ticketId &&
        uploadRes.body.ticket_message_id === messageId,
      'the attachment row records both ticket_id and ticket_message_id',
    );

    const onDiskFiles = await fs.readdir(storageDir);
    assert(
      onDiskFiles.length === 1,
      'the file was actually written to the storage directory',
    );
    assert(
      onDiskFiles[0] !== 'screenshot.png',
      'the file is stored under a random key, not the original filename (avoids collisions/traversal)',
    );

    const wrongTicketUpload = await request(server)
      .post(
        `/api/v1/tickets/00000000-0000-4000-8000-000000000000/messages/${messageId}/attachments`,
      )
      .set('X-Tenant-Id', tenant.id)
      .attach('file', fileContents, 'x.png');
    assert(
      wrongTicketUpload.status === 404,
      "uploading to a message that doesn't belong to the given ticket id is rejected with 404",
    );

    const listRes = await request(server)
      .get(`/api/v1/tickets/${ticketId}/attachments`)
      .set('X-Tenant-Id', tenant.id);
    assert(
      listRes.status === 200 &&
        listRes.body.length === 1 &&
        listRes.body[0].id === uploadRes.body.id,
      'listing attachments for the ticket returns the uploaded file',
    );

    const downloadRes = await request(server)
      .get(
        `/api/v1/tickets/${ticketId}/attachments/${uploadRes.body.id}/download`,
      )
      .set('X-Tenant-Id', tenant.id);
    assert(
      downloadRes.status === 200 &&
        Buffer.compare(downloadRes.body, fileContents) === 0,
      'downloading the attachment returns the exact original bytes',
    );
    assert(
      downloadRes.headers['content-disposition']?.includes('screenshot.png'),
      'the download response sets Content-Disposition with the original filename',
    );
    assert(
      downloadRes.headers['content-disposition']?.includes("filename*=UTF-8''"),
      'the download response includes an RFC 5987 filename* fallback for non-ASCII filenames',
    );

    // A DB row whose backing file is missing from disk (non-durable local
    // storage, wiped by a redeploy) must 404 cleanly, not crash the server.
    const onDiskPath = path.join(storageDir, onDiskFiles[0]);
    await fs.rm(onDiskPath);
    const missingFileDownload = await request(server)
      .get(
        `/api/v1/tickets/${ticketId}/attachments/${uploadRes.body.id}/download`,
      )
      .set('X-Tenant-Id', tenant.id);
    assert(
      missingFileDownload.status === 404,
      'downloading an attachment whose file is missing from disk returns 404 instead of crashing',
    );
    // The server process itself must still be alive and responsive.
    const stillAliveRes = await request(server)
      .get(`/api/v1/tickets/${ticketId}/attachments`)
      .set('X-Tenant-Id', tenant.id);
    assert(
      stillAliveRes.status === 200,
      'the server is still responsive after a missing-file download attempt',
    );

    const missingDownload = await request(server)
      .get(
        `/api/v1/tickets/${ticketId}/attachments/00000000-0000-4000-8000-000000000000/download`,
      )
      .set('X-Tenant-Id', tenant.id);
    assert(
      missingDownload.status === 404,
      'downloading a nonexistent attachment id returns 404',
    );

    // Cross-tenant isolation: a second tenant must not be able to list or
    // download the first tenant's attachment, even by guessing its id.
    const {
      rows: [otherTenant],
    } = await migrator.query(
      `INSERT INTO tenants (name, slug, plan_tier) VALUES ('Other Tenant', $1, 'internal') RETURNING id`,
      [`attachments-verify-other-${Date.now()}`],
    );
    const crossTenantDownload = await request(server)
      .get(
        `/api/v1/tickets/${ticketId}/attachments/${uploadRes.body.id}/download`,
      )
      .set('X-Tenant-Id', otherTenant.id);
    assert(
      crossTenantDownload.status === 404,
      "a different tenant cannot download another tenant's attachment even with the right id",
    );
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [otherTenant.id]);

    console.log('\nAll attachment checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
    await fs.rm(storageDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
