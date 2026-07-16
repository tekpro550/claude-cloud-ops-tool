import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';

export interface AuditEntry {
  /** The logged-in user who made the change, if the request carried an identity. */
  actorUserId?: string;
  /** Namespaced action, e.g. 'business_hours.update'. */
  action: string;
  /** The kind of thing changed, e.g. 'business_hours', 'automation_rule'. */
  entityType: string;
  /** Optional id of the specific entity. */
  entityId?: string;
  /** One-line human-readable description of what happened. */
  summary: string;
  /** Optional structured before/after or extra context. */
  details?: Record<string, unknown>;
}

/**
 * Append-only admin/config audit trail (Platform boundary). record() is
 * best-effort -- a failure to write an audit row must never fail the
 * underlying admin action, so it logs and swallows. Callers invoke it after a
 * successful mutation, passing the actor from the request identity.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async record(tenantId: string, entry: AuditEntry): Promise<void> {
    try {
      await withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
        let actorLabel: string | null = null;
        if (entry.actorUserId) {
          const [user] = await queryRunner.query(
            `SELECT COALESCE(name, email) AS label FROM users WHERE id = $1`,
            [entry.actorUserId],
          );
          actorLabel = user?.label ?? null;
        }
        await queryRunner.query(
          `INSERT INTO admin_audit_log
             (tenant_id, actor_user_id, actor_label, action, entity_type, entity_id, summary, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenantId,
            entry.actorUserId ?? null,
            actorLabel,
            entry.action,
            entry.entityType,
            entry.entityId ?? null,
            entry.summary,
            JSON.stringify(entry.details ?? {}),
          ],
        );
      });
    } catch (err) {
      this.logger.error(
        `failed to record audit entry '${entry.action}' for tenant ${tenantId}: ${(err as Error).message}`,
      );
    }
  }

  async list(
    tenantId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ items: unknown[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const items = await queryRunner.query(
        `SELECT id, actor_user_id, actor_label, action, entity_type, entity_id, summary, details, created_at
         FROM admin_audit_log
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const [{ count }] = await queryRunner.query(
        `SELECT count(*)::int AS count FROM admin_audit_log`,
      );
      return { items, total: count };
    });
  }
}
