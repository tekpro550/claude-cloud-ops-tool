import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { CloudCredentialsService } from '../cloud-credentials.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Credentials encryption verification FAILED: ${message}`);
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

const KEY =
  process.env.CREDENTIALS_ENCRYPTION_KEY ??
  'dev-only-credentials-key-change-me-in-prod';

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `creds-encryption-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Creds Encryption Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const credentials = app.get(CloudCredentialsService);

  const SECRET = 'AKIA-super-secret-value-12345';
  try {
    const created = await credentials.create(tenant.id, {
      provider: 'aws',
      label: 'Encryption test account',
      config: {
        region: 'us-east-1',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: SECRET,
      },
    });
    assert(
      !('config' in created) && !('config_encrypted' in created),
      'create() never echoes the config or its ciphertext back in the response',
    );

    // At rest, the raw column must be ciphertext -- the plaintext secret must
    // not appear anywhere in the stored bytes.
    const { rows: raw } = await migrator.query(
      `SELECT config_encrypted, encode(config_encrypted, 'escape') AS as_text FROM cloud_credentials WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(raw.length === 1, 'the credential row was persisted');
    assert(
      !raw[0].as_text.includes(SECRET),
      'the plaintext secret does not appear in the stored bytes (encrypted at rest)',
    );
    assert(
      !raw[0].as_text.includes('accessKeyId'),
      'no plaintext config keys are visible in the stored bytes either',
    );

    // With the key, pgcrypto round-trips it back to the original JSON.
    const { rows: dec } = await migrator.query(
      `SELECT pgp_sym_decrypt(config_encrypted, $2)::jsonb AS config FROM cloud_credentials WHERE tenant_id = $1`,
      [tenant.id, KEY],
    );
    assert(
      dec[0].config.secretAccessKey === SECRET,
      'decrypting with the app key recovers the original secret',
    );

    // Updating the config re-encrypts (still no plaintext at rest).
    const {
      rows: [row],
    } = await migrator.query(
      `SELECT id FROM cloud_credentials WHERE tenant_id = $1`,
      [tenant.id],
    );
    const NEW_SECRET = 'rotated-secret-98765';
    await credentials.update(tenant.id, row.id, {
      config: {
        region: 'eu-west-1',
        accessKeyId: 'AKIANEW',
        secretAccessKey: NEW_SECRET,
      },
    });
    const { rows: raw2 } = await migrator.query(
      `SELECT encode(config_encrypted, 'escape') AS as_text, pgp_sym_decrypt(config_encrypted, $2)::jsonb AS config
       FROM cloud_credentials WHERE tenant_id = $1`,
      [tenant.id, KEY],
    );
    assert(
      !raw2[0].as_text.includes(NEW_SECRET),
      'a rotated secret is also encrypted at rest, not stored in plaintext',
    );
    assert(
      raw2[0].config.secretAccessKey === NEW_SECRET,
      'update() re-encrypts the new config so it still decrypts correctly',
    );

    console.log('\nAll credentials encryption checks passed.');
  } finally {
    await migrator.query(`DELETE FROM cloud_credentials WHERE tenant_id = $1`, [
      tenant.id,
    ]);
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
