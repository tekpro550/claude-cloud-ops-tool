import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = ['network_devices', 'network_interface_samples'];

/**
 * Site24x7-style SNMP/network monitoring: poll routers/switches for
 * per-interface up/down + throughput. `community_encrypted` follows
 * cloud_credentials' pgcrypto pattern (pgp_sym_encrypt/pgp_sym_decrypt with
 * CREDENTIALS_ENCRYPTION_KEY, see credentials-crypto.ts) -- the SNMP
 * community string is a shared secret the same way a cloud API key is, and
 * is never returned by the API (network-devices.service.ts's SAFE_COLUMNS
 * excludes it entirely).
 */
export class CreateNetworkMonitoring1784500000000 implements MigrationInterface {
  name = 'CreateNetworkMonitoring1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE network_devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        host text NOT NULL,
        snmp_version text NOT NULL DEFAULT '2c' CHECK (snmp_version IN ('1', '2c', '3')),
        community_encrypted bytea NOT NULL,
        port int NOT NULL DEFAULT 161,
        is_active boolean NOT NULL DEFAULT true,
        last_polled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_network_devices_tenant_id ON network_devices(tenant_id);

      CREATE TABLE network_interface_samples (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        network_device_id uuid NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
        if_index int NOT NULL,
        if_name text,
        oper_status text NOT NULL CHECK (oper_status IN ('up', 'down', 'unknown')),
        in_octets bigint NOT NULL DEFAULT 0,
        out_octets bigint NOT NULL DEFAULT 0,
        ts timestamptz NOT NULL DEFAULT now()
      );
      -- "Latest sample per interface" (dashboard) and "previous sample for
      -- this interface" (throughput delta, up/down transition detection)
      -- both filter by (device, if_index) and sort by ts.
      CREATE INDEX idx_network_interface_samples_device_if_ts
        ON network_interface_samples (tenant_id, network_device_id, if_index, ts DESC);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON network_devices, network_interface_samples TO app_user;`,
    );

    for (const table of RLS_TABLES) {
      await queryRunner.query(`
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of RLS_TABLES) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      `);
    }
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON network_devices, network_interface_samples FROM app_user;`,
    );
    await queryRunner.query(`
      DROP TABLE IF EXISTS network_interface_samples;
      DROP TABLE IF EXISTS network_devices;
    `);
  }
}
