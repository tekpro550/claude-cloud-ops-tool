import { MigrationInterface, QueryRunner } from 'typeorm';

// One shared temporary password for the six agent users seeded by
// SeedTenantZeroAndAgents (whose password_hash was the literal placeholder
// 'unset:auth-not-implemented-yet' since auth didn't exist yet). Bcrypt-hash
// it with pgcrypto's crypt()/gen_salt('bf') -- already available since the
// data source forces the pgcrypto extension -- so this stays a plain SQL
// migration with no app-side hashing step. Tekpro's team should rotate this
// via a real change-password flow once one exists; it's a pilot-only
// bootstrap value, not meant to be long-lived.
const TEMP_PASSWORD = 'ChangeMe123!';

const SEEDED_AGENT_EMAILS = [
  'vincent.dsouza@tekprocloud.com',
  'srinath.sreedharan@tekprocloud.com',
  'ruthvik.m@tekprocloud.com',
  'sohel.s@tekprocloud.com',
  'sparsh@tekprocloud.com',
  'manoj.k@tekprocloud.com',
];

export class SeedAgentPasswords1784040000000 implements MigrationInterface {
  name = 'SeedAgentPasswords1784040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users SET password_hash = crypt($1, gen_salt('bf'))
       WHERE password_hash = 'unset:auth-not-implemented-yet'`,
      [TEMP_PASSWORD],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users SET password_hash = 'unset:auth-not-implemented-yet'
       WHERE email = ANY($1)`,
      [SEEDED_AGENT_EMAILS],
    );
  }
}
