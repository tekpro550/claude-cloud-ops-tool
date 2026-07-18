import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Public status pages: a tenant curates a shareable, unauthenticated page
 * (Site24x7-style) showing up/down + uptime for a chosen set of monitors.
 *
 * status_pages.slug is the public lookup key. Resolving "slug -> tenant_id"
 * has to happen with NO tenant context (the visitor's browser carries no
 * X-Tenant-Id/JWT), so on top of the normal tenant_isolation policy this adds
 * a second, narrowly-scoped PERMISSIVE SELECT policy on status_pages only:
 * `USING (is_public = true AND current_setting('app.public_status_read', true) = 'true')`.
 * Postgres OR's permissive policies for the same command, so a SELECT is
 * allowed when EITHER the caller's tenant matches (the admin path, via
 * withTenantContext) OR both the row is public AND the caller explicitly
 * opted into a public read.
 *
 * That second condition is deliberate and load-bearing: `is_public = true`
 * ALONE would leak every tenant's public status pages into every OTHER
 * tenant's normal admin list/get queries too, since a permissive policy
 * matches regardless of which tenant is asking -- there'd be no way to tell
 * "an anonymous visitor by slug" apart from "tenant B listing its own pages"
 * once is_public is true. Gating it on a transaction-local
 * `app.public_status_read` flag (set via set_config(..., true) -- SET LOCAL,
 * auto-reset at commit, exactly like app.current_tenant, so it can never leak
 * onto a pooled connection's next unrelated query) means only
 * StatusPagesService.getPublicStatus's dedicated, un-tenant-scoped read ever
 * sets it; every ordinary admin query leaves it unset and never matches this
 * policy. See verify-status-pages.ts's "RLS hides one tenant's status pages
 * from another" check, which caught the leak before this comment existed.
 *
 * This only ever widens SELECT -- INSERT/UPDATE/DELETE still go solely
 * through tenant_isolation's WITH CHECK, so a public page can be read but
 * never mutated. No public policy exists on status_page_monitors; the
 * service loads those only after re-entering tenant context for the
 * resolved tenant_id, and returns a hand-picked set of display fields --
 * never the raw rows -- to the anonymous caller.
 */
export class CreateStatusPages1784410000000 implements MigrationInterface {
  name = 'CreateStatusPages1784410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE status_pages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        slug text NOT NULL UNIQUE,
        title text NOT NULL,
        description text,
        is_public boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_status_pages_tenant_id ON status_pages (tenant_id);

      CREATE TABLE status_page_monitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        status_page_id uuid NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
        monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        display_name text,
        sort_order int NOT NULL DEFAULT 0,
        UNIQUE (status_page_id, monitor_id)
      );
      CREATE INDEX idx_status_page_monitors_page ON status_page_monitors (status_page_id, sort_order);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON status_pages, status_page_monitors TO app_user;`,
    );

    for (const table of ['status_pages', 'status_page_monitors']) {
      await queryRunner.query(`
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
      `);
    }

    // The one deliberate widening: anonymous SELECT of a page's own public
    // display columns by slug, gated on an explicit opt-in flag so it can't
    // leak into ordinary tenant-scoped queries. See the class doc comment.
    await queryRunner.query(`
      CREATE POLICY public_read ON status_pages
        FOR SELECT
        USING (
          is_public = true
          AND current_setting('app.public_status_read', true) = 'true'
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS public_read ON status_pages;`,
    );
    for (const table of ['status_pages', 'status_page_monitors']) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      `);
      await queryRunner.query(
        `REVOKE ALL PRIVILEGES ON ${table} FROM app_user;`,
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS status_page_monitors;`);
    await queryRunner.query(`DROP TABLE IF EXISTS status_pages;`);
  }
}
