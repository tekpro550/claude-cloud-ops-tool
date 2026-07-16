import { MigrationInterface, QueryRunner } from 'typeorm';
import { credentialsEncryptionKeyFromEnv } from '../../modules/monitoring/credentials-crypto';

/**
 * Encrypts cloud_credentials.config at rest. The review flagged that raw
 * AWS/Azure secrets sat in plaintext jsonb -- "one DB dump away". This
 * replaces the plaintext `config` jsonb column with a `config_encrypted`
 * bytea column holding a pgcrypto pgp_sym_encrypt envelope keyed on the
 * app's CREDENTIALS_ENCRYPTION_KEY, so a database dump on its own yields
 * only ciphertext.
 *
 * The key is passed as a bound parameter (never string-concatenated into
 * SQL) and lives in the app environment, not the database.
 */
export class EncryptCloudCredentials1784180000000 implements MigrationInterface {
  name = 'EncryptCloudCredentials1784180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const key = credentialsEncryptionKeyFromEnv();

    await queryRunner.query(
      `ALTER TABLE cloud_credentials ADD COLUMN config_encrypted bytea`,
    );
    // Backfill: encrypt every existing row's plaintext config in place.
    await queryRunner.query(
      `UPDATE cloud_credentials SET config_encrypted = pgp_sym_encrypt(config::text, $1)`,
      [key],
    );
    await queryRunner.query(
      `ALTER TABLE cloud_credentials ALTER COLUMN config_encrypted SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE cloud_credentials DROP COLUMN config`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const key = credentialsEncryptionKeyFromEnv();

    await queryRunner.query(
      `ALTER TABLE cloud_credentials ADD COLUMN config jsonb`,
    );
    await queryRunner.query(
      `UPDATE cloud_credentials SET config = pgp_sym_decrypt(config_encrypted, $1)::jsonb`,
      [key],
    );
    await queryRunner.query(
      `ALTER TABLE cloud_credentials ALTER COLUMN config SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE cloud_credentials DROP COLUMN config_encrypted`,
    );
  }
}
