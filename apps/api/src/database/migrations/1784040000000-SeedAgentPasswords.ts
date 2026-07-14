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
    // Symmetric with up(): match by "does this row's hash verify against
    // TEMP_PASSWORD" (pgcrypto's crypt() re-hashes using the salt embedded
    // in the existing hash, so equality means the password matches) rather
    // than a hardcoded email list -- that way this reverts exactly the rows
    // up() touched, regardless of which tenant they belong to, instead of
    // leaving a real password hash in place for any user outside the
    // original six seeded emails.
    await queryRunner.query(
      `UPDATE users SET password_hash = 'unset:auth-not-implemented-yet'
       WHERE password_hash = crypt($1, password_hash)`,
      [TEMP_PASSWORD],
    );
  }
}
