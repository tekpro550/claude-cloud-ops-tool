import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  applyAction,
  assertActionTargetsBelongToTenant,
} from './automation/apply-action';
import { CreateScenarioDto, UpdateScenarioDto } from './scenarios.dto';

async function assertAgentBelongsToTenant(
  queryRunner: QueryRunner,
  agentId: string,
): Promise<void> {
  const rows = await queryRunner.query(`SELECT 1 FROM agents WHERE id = $1`, [
    agentId,
  ]);
  if (rows.length === 0) {
    throw new BadRequestException(`Agent ${agentId} not found for this tenant`);
  }
}

@Injectable()
export class ScenariosService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM scenarios ORDER BY name`),
    );
  }

  create(tenantId: string, dto: CreateScenarioDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      if (dto.agentId) {
        await assertAgentBelongsToTenant(queryRunner, dto.agentId);
      }
      await assertActionTargetsBelongToTenant(queryRunner, dto.actions);
      const [scenario] = await queryRunner.query(
        `INSERT INTO scenarios (tenant_id, agent_id, name, actions) VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, dto.agentId ?? null, dto.name, JSON.stringify(dto.actions)],
      );
      return scenario;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateScenarioDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM scenarios WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Scenario ${id} not found`);
      }
      if (dto.agentId) {
        await assertAgentBelongsToTenant(queryRunner, dto.agentId);
      }
      if (dto.actions) {
        await assertActionTargetsBelongToTenant(queryRunner, dto.actions);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.agentId !== undefined) assign('agent_id', dto.agentId);
      if (dto.actions !== undefined)
        assign('actions', JSON.stringify(dto.actions));

      if (sets.length === 0) {
        const [scenario] = await queryRunner.query(
          `SELECT * FROM scenarios WHERE id = $1`,
          [id],
        );
        return scenario;
      }

      sets.push('updated_at = now()');
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE scenarios SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM scenarios WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Scenario ${id} not found`);
      }
    });
  }

  /** Applies every action in the scenario to one ticket immediately (the one-click macro button). */
  async apply(tenantId: string, scenarioId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [scenario] = await queryRunner.query(
        `SELECT * FROM scenarios WHERE id = $1`,
        [scenarioId],
      );
      if (!scenario) {
        throw new NotFoundException(`Scenario ${scenarioId} not found`);
      }
      const [ticket] = await queryRunner.query(
        `SELECT * FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }

      let current = ticket;
      for (const action of scenario.actions) {
        current = await applyAction(tenantId, current, action, queryRunner);
      }
      return current;
    });
  }
}
