import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './alert-rules.dto';

const DUPLICATE_KEY_ERROR = '23505';

/**
 * Cross-field requirement: which fields a rule_kind needs, checked here
 * (rather than only via DTO decorators) so create and update -- where a
 * ruleKind change and its metric/comparator/threshold can arrive in
 * different calls -- both land on a fully valid row.
 */
function assertRuleKindFieldsPresent(fields: {
  ruleKind: string;
  metric?: string | null;
  comparator?: string | null;
  threshold?: number | null;
  anomalySensitivity?: number | null;
}): void {
  if (fields.ruleKind === 'threshold') {
    if (!fields.metric || !fields.comparator || fields.threshold == null) {
      throw new BadRequestException(
        'A threshold rule requires metric, comparator, and threshold',
      );
    }
  }
  if (fields.ruleKind === 'anomaly') {
    if (!fields.metric || fields.anomalySensitivity == null) {
      throw new BadRequestException(
        'An anomaly rule requires metric and anomalySensitivity',
      );
    }
  }
}

@Injectable()
export class AlertRulesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM alert_rules ORDER BY created_at`),
    );
  }

  create(tenantId: string, dto: CreateAlertRuleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [monitor] = await queryRunner.query(
        `SELECT id FROM monitors WHERE id = $1`,
        [dto.monitorId],
      );
      if (!monitor) {
        throw new NotFoundException(`Monitor ${dto.monitorId} not found`);
      }

      const ruleKind = dto.ruleKind ?? 'status';
      assertRuleKindFieldsPresent({ ruleKind, ...dto });

      try {
        const [rule] = await queryRunner.query(
          `INSERT INTO alert_rules (
             tenant_id, monitor_id, condition, severity, is_enabled, escalation_policy_id,
             rule_kind, metric, comparator, threshold, for_consecutive, anomaly_sensitivity
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            tenantId,
            dto.monitorId,
            JSON.stringify(dto.condition ?? { statusIn: ['down', 'critical'] }),
            dto.severity ?? 'critical',
            dto.isEnabled ?? true,
            dto.escalationPolicyId ?? null,
            ruleKind,
            dto.metric ?? null,
            dto.comparator ?? null,
            dto.threshold ?? null,
            dto.forConsecutive ?? 1,
            dto.anomalySensitivity ?? null,
          ],
        );
        return rule;
      } catch (err) {
        if ((err as { code?: string }).code === DUPLICATE_KEY_ERROR) {
          throw new BadRequestException(
            `Monitor ${dto.monitorId} already has an alert rule`,
          );
        }
        throw err;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAlertRuleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT * FROM alert_rules WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Alert rule ${id} not found`);
      }

      // Validate against the merged (existing + incoming) shape, since a
      // PATCH updating just `threshold` on an already-threshold rule must
      // still see the rule's existing metric/comparator to pass, and a PATCH
      // switching ruleKind to 'threshold' must bring its own.
      assertRuleKindFieldsPresent({
        ruleKind: dto.ruleKind ?? existing.rule_kind,
        metric: dto.metric !== undefined ? dto.metric : existing.metric,
        comparator:
          dto.comparator !== undefined ? dto.comparator : existing.comparator,
        threshold:
          dto.threshold !== undefined ? dto.threshold : existing.threshold,
        anomalySensitivity:
          dto.anomalySensitivity !== undefined
            ? dto.anomalySensitivity
            : existing.anomaly_sensitivity,
      });

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.condition !== undefined)
        assign('condition', JSON.stringify(dto.condition));
      if (dto.severity !== undefined) assign('severity', dto.severity);
      if (dto.isEnabled !== undefined) assign('is_enabled', dto.isEnabled);
      if (dto.escalationPolicyId !== undefined)
        assign('escalation_policy_id', dto.escalationPolicyId);
      if (dto.ruleKind !== undefined) assign('rule_kind', dto.ruleKind);
      if (dto.metric !== undefined) assign('metric', dto.metric);
      if (dto.comparator !== undefined) assign('comparator', dto.comparator);
      if (dto.threshold !== undefined) assign('threshold', dto.threshold);
      if (dto.forConsecutive !== undefined)
        assign('for_consecutive', dto.forConsecutive);
      if (dto.anomalySensitivity !== undefined)
        assign('anomaly_sensitivity', dto.anomalySensitivity);

      if (sets.length === 0) {
        const [rule] = await queryRunner.query(
          `SELECT * FROM alert_rules WHERE id = $1`,
          [id],
        );
        return rule;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE alert_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM alert_rules WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Alert rule ${id} not found`);
      }
    });
  }
}
