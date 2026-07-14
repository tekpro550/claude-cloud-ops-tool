import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from './notification-templates.dto';

const DUPLICATE_KEY_ERROR = '23505';

@Injectable()
export class NotificationTemplatesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM notification_templates ORDER BY channel, event_type`,
      ),
    );
  }

  create(tenantId: string, dto: CreateNotificationTemplateDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      try {
        const [template] = await queryRunner.query(
          `INSERT INTO notification_templates (tenant_id, channel, event_type, subject, body, is_default)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            tenantId,
            dto.channel,
            dto.eventType,
            dto.subject ?? null,
            dto.body,
            dto.isDefault ?? false,
          ],
        );
        return template;
      } catch (err) {
        if ((err as { code?: string }).code === DUPLICATE_KEY_ERROR) {
          throw new BadRequestException(
            `A default template already exists for ${dto.channel}/${dto.eventType}`,
          );
        }
        throw err;
      }
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateNotificationTemplateDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM notification_templates WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Notification template ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.subject !== undefined) assign('subject', dto.subject);
      if (dto.body !== undefined) assign('body', dto.body);
      if (dto.isDefault !== undefined) assign('is_default', dto.isDefault);

      if (sets.length === 0) {
        const [template] = await queryRunner.query(
          `SELECT * FROM notification_templates WHERE id = $1`,
          [id],
        );
        return template;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      try {
        const [rows] = await queryRunner.query(
          `UPDATE notification_templates SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        return rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === DUPLICATE_KEY_ERROR) {
          throw new BadRequestException(
            `A default template already exists for this channel/event_type`,
          );
        }
        throw err;
      }
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM notification_templates WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Notification template ${id} not found`);
      }
    });
  }
}
