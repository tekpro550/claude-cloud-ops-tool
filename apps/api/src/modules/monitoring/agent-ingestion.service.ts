import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { AlertEvaluationService } from './alert-evaluation.service';
import { evaluateAgentReport } from './checks/agent-report-check';
import { AgentReportDto } from './agent-report.dto';

@Injectable()
export class AgentIngestionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly alertEvaluation: AlertEvaluationService,
  ) {}

  async heartbeat(tenantId: string, agentTokenId: string): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `UPDATE agent_tokens SET last_seen_at = now() WHERE id = $1`,
        [agentTokenId],
      ),
    );
  }

  /**
   * A report always refreshes last_seen_at, same as a heartbeat. If the
   * resource also has an enabled 'server_agent' monitor, the reported
   * metrics are turned into a CheckResult and run through the same
   * monitor_checks + AlertEvaluationService path every other monitor type
   * uses -- a resource without one just gets its staleness clock reset with
   * nothing further to evaluate.
   */
  async report(
    tenantId: string,
    agentTokenId: string,
    resourceId: string,
    dto: AgentReportDto,
  ): Promise<void> {
    await this.heartbeat(tenantId, agentTokenId);

    const monitor = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT id, name, resource_id, config, consecutive_failures_to_alert
         FROM monitors
         WHERE resource_id = $1 AND monitor_type = 'server_agent' AND is_enabled = true
         LIMIT 1`,
          [resourceId],
        );
        return row ?? null;
      },
    );
    if (!monitor) return;

    const result = evaluateAgentReport(monitor.config ?? {}, dto);

    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, raw_output)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantId,
          monitor.id,
          result.status,
          result.responseTimeMs,
          JSON.stringify(result.rawOutput),
        ],
      ),
    );

    await this.alertEvaluation.evaluate(
      tenantId,
      {
        id: monitor.id,
        name: monitor.name,
        resourceId: monitor.resource_id,
        consecutiveFailuresToAlert: monitor.consecutive_failures_to_alert,
      },
      result,
    );
  }
}
