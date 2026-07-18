import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { AddAgentSkillDto } from './agent-skills.dto';

@Injectable()
export class AgentSkillsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string, agentId?: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) => {
      if (agentId) {
        return queryRunner.query(
          `SELECT * FROM agent_skills WHERE agent_id = $1 ORDER BY skill`,
          [agentId],
        );
      }
      return queryRunner.query(
        `SELECT * FROM agent_skills ORDER BY agent_id, skill`,
      );
    });
  }

  add(tenantId: string, dto: AddAgentSkillDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [skill] = await queryRunner.query(
        `INSERT INTO agent_skills (tenant_id, agent_id, skill) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, agent_id, skill) DO UPDATE SET skill = EXCLUDED.skill
         RETURNING *`,
        [tenantId, dto.agentId, dto.skill.trim()],
      );
      return skill;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM agent_skills WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Agent skill ${id} not found`);
      }
    });
  }
}
