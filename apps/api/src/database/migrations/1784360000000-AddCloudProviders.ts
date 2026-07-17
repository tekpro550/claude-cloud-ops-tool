import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen cloud_provider_enum beyond aws/azure to gcp, alibaba, digitalocean and
 * oracle, so credentials can be stored and billing ingested for them through
 * the same CostBillingSyncService loop.
 *
 * PostgreSQL can't drop enum values in place, so down() recreates the type with
 * only aws/azure and re-points cloud_credentials.provider (fails, correctly, if
 * any row already uses a new provider).
 */
export class AddCloudProviders1784360000000 implements MigrationInterface {
  name = 'AddCloudProviders1784360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const provider of ['gcp', 'alibaba', 'digitalocean', 'oracle']) {
      await queryRunner.query(
        `ALTER TYPE cloud_provider_enum ADD VALUE IF NOT EXISTS '${provider}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE cloud_provider_enum RENAME TO cloud_provider_enum_old`,
    );
    await queryRunner.query(
      `CREATE TYPE cloud_provider_enum AS ENUM ('aws', 'azure')`,
    );
    await queryRunner.query(
      `ALTER TABLE cloud_credentials ALTER COLUMN provider TYPE cloud_provider_enum
       USING provider::text::cloud_provider_enum`,
    );
    await queryRunner.query(`DROP TYPE cloud_provider_enum_old`);
  }
}
