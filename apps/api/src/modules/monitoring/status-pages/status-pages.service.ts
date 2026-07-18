import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AddStatusPageMonitorDto,
  CreateStatusPageDto,
  UpdateStatusPageDto,
} from './status-pages.dto';

const UPTIME_WINDOW_DAYS = 90;

@Injectable()
export class StatusPagesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ---- Admin CRUD (tenant-scoped, same pattern as every other admin resource) ----

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM status_pages ORDER BY created_at DESC`),
    );
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [page] = await queryRunner.query(
        `SELECT * FROM status_pages WHERE id = $1`,
        [id],
      );
      if (!page) throw new NotFoundException(`Status page ${id} not found`);
      const monitors = await queryRunner.query(
        `SELECT spm.*, m.name AS monitor_name
           FROM status_page_monitors spm
           JOIN monitors m ON m.id = spm.monitor_id
          WHERE spm.status_page_id = $1
          ORDER BY spm.sort_order, spm.id`,
        [id],
      );
      return { ...page, monitors };
    });
  }

  create(tenantId: string, dto: CreateStatusPageDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      try {
        const [page] = await queryRunner.query(
          `INSERT INTO status_pages (tenant_id, slug, title, description, is_public)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            tenantId,
            dto.slug,
            dto.title,
            dto.description ?? null,
            dto.isPublic ?? true,
          ],
        );
        return page;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new BadRequestException(
            `slug "${dto.slug}" is already taken by another status page`,
          );
        }
        throw err;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateStatusPageDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.title !== undefined) assign('title', dto.title);
      if (dto.description !== undefined) assign('description', dto.description);
      if (dto.isPublic !== undefined) assign('is_public', dto.isPublic);

      if (sets.length === 0) {
        const [page] = await queryRunner.query(
          `SELECT * FROM status_pages WHERE id = $1`,
          [id],
        );
        if (!page) throw new NotFoundException(`Status page ${id} not found`);
        return page;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE status_pages SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      if (!rows[0]) throw new NotFoundException(`Status page ${id} not found`);
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM status_pages WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Status page ${id} not found`);
      }
    });
  }

  async addMonitor(
    tenantId: string,
    statusPageId: string,
    dto: AddStatusPageMonitorDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [page] = await queryRunner.query(
        `SELECT id FROM status_pages WHERE id = $1`,
        [statusPageId],
      );
      if (!page) {
        throw new NotFoundException(`Status page ${statusPageId} not found`);
      }
      const [monitor] = await queryRunner.query(
        `SELECT id FROM monitors WHERE id = $1`,
        [dto.monitorId],
      );
      if (!monitor) {
        throw new BadRequestException(
          `Monitor ${dto.monitorId} does not exist for this tenant`,
        );
      }
      try {
        const [link] = await queryRunner.query(
          `INSERT INTO status_page_monitors (tenant_id, status_page_id, monitor_id, display_name, sort_order)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            tenantId,
            statusPageId,
            dto.monitorId,
            dto.displayName ?? null,
            dto.sortOrder ?? 0,
          ],
        );
        return link;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new BadRequestException(
            `Monitor ${dto.monitorId} is already on status page ${statusPageId}`,
          );
        }
        throw err;
      }
    });
  }

  async removeMonitor(
    tenantId: string,
    statusPageId: string,
    linkId: string,
  ): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM status_page_monitors WHERE id = $1 AND status_page_id = $2 RETURNING id`,
        [linkId, statusPageId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(
          `Status page monitor link ${linkId} not found`,
        );
      }
    });
  }

  /**
   * Public, unauthenticated read by slug. Runs the first query with NO tenant
   * context at all -- it's allowed only because of status_pages' `public_read`
   * RLS policy (is_public = true AND the app.public_status_read flag below),
   * which is the one deliberate widening this feature adds (see the
   * CreateStatusPages migration doc comment). The flag is set SET LOCAL
   * (transaction-scoped, like app.current_tenant) so it can never leak onto a
   * pooled connection's next, unrelated query -- only this one lookup, inside
   * its own short transaction, ever sees it set. Once the owning tenant is
   * known, everything else is read the normal RLS-scoped way via
   * withTenantContext, and only a hand-picked set of display fields is ever
   * returned -- never tenant_id, monitor config, or anything else.
   */
  async getPublicStatus(slug: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let page: {
      id: string;
      tenant_id: string;
      title: string;
      description: string | null;
    };
    try {
      await queryRunner.query(
        "SELECT set_config('app.public_status_read', 'true', true)",
      );
      [page] = await queryRunner.query(
        `SELECT id, tenant_id, title, description FROM status_pages WHERE slug = $1 AND is_public = true`,
        [slug],
      );
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
    if (!page) {
      throw new NotFoundException(`No public status page at "${slug}"`);
    }

    return withTenantContext(
      this.dataSource,
      page.tenant_id,
      async (queryRunner) => {
        const links = await queryRunner.query(
          `SELECT spm.monitor_id, spm.display_name, spm.sort_order, m.name AS monitor_name
             FROM status_page_monitors spm
             JOIN monitors m ON m.id = spm.monitor_id
            WHERE spm.status_page_id = $1
            ORDER BY spm.sort_order, spm.id`,
          [page.id],
        );

        const components = await Promise.all(
          links.map(async (link: Record<string, unknown>) => {
            const [latest] = await queryRunner.query(
              `SELECT status FROM monitor_checks
                 WHERE monitor_id = $1
                 ORDER BY checked_at DESC
                 LIMIT 1`,
              [link.monitor_id],
            );
            const [uptime] = await queryRunner.query(
              `SELECT
                 count(*) FILTER (WHERE status = 'up')::float
                   / GREATEST(count(*), 1)::float AS ratio,
                 count(*)::int AS sample_count
               FROM monitor_checks
               WHERE monitor_id = $1 AND checked_at >= now() - $2::interval`,
              [link.monitor_id, `${UPTIME_WINDOW_DAYS} days`],
            );
            return {
              name: link.display_name ?? link.monitor_name,
              status: latest?.status ?? 'unknown',
              uptimePct:
                uptime.sample_count > 0
                  ? Math.round(uptime.ratio * 10000) / 100
                  : null,
            };
          }),
        );

        return {
          title: page.title,
          description: page.description,
          components,
        };
      },
    );
  }
}
