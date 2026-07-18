import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  buildDailySpend,
  computeCoverage,
  computeUtilization,
  DailySpendRow,
} from './commitment-coverage';
import { CreateCommitmentDto } from './commitments.dto';

@Injectable()
export class CommitmentsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM commitments ORDER BY start_date DESC`),
    );
  }

  create(tenantId: string, dto: CreateCommitmentDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [credential] = await queryRunner.query(
        `SELECT id FROM cloud_credentials WHERE id = $1`,
        [dto.cloudCredentialId],
      );
      if (!credential) {
        throw new NotFoundException(
          `Cloud credential ${dto.cloudCredentialId} not found`,
        );
      }

      const [commitment] = await queryRunner.query(
        `INSERT INTO commitments (
           tenant_id, cloud_credential_id, kind, service, region,
           term_months, payment_option, hourly_commitment, start_date, end_date
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          tenantId,
          dto.cloudCredentialId,
          dto.kind,
          dto.service,
          dto.region ?? null,
          dto.termMonths,
          dto.paymentOption ?? 'no_upfront',
          dto.hourlyCommitment,
          dto.startDate,
          dto.endDate,
        ],
      );
      return commitment;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM commitments WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Commitment ${id} not found`);
      }
    });
  }

  /**
   * Coverage/utilization for one owned commitment, computed from
   * cost_line_items over [commitment.start_date, min(end_date, today)]. Null
   * when that window hasn't started yet or contains no days at all.
   */
  async getCoverage(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [commitment] = await queryRunner.query(
        `SELECT * FROM commitments WHERE id = $1`,
        [id],
      );
      if (!commitment) {
        throw new NotFoundException(`Commitment ${id} not found`);
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const startDate = new Date(commitment.start_date);
      const endDate = new Date(
        Math.min(new Date(commitment.end_date).getTime(), today.getTime()),
      );

      if (endDate < startDate) {
        return {
          commitment,
          coverage: null,
          utilization: null,
          reason: 'commitment term has not started yet',
        };
      }

      const dailySpend = await this.loadDailySpend(
        queryRunner,
        commitment.cloud_credential_id,
        commitment.service,
        commitment.region,
        startDate,
        endDate,
      );
      const dailyCommitmentAmount = Number(commitment.hourly_commitment) * 24;
      const coverage = computeCoverage(dailySpend, dailyCommitmentAmount);
      const utilization = computeUtilization(dailySpend, dailyCommitmentAmount);
      return { commitment, coverage, utilization, reason: null };
    });
  }

  private async loadDailySpend(
    queryRunner: QueryRunner,
    cloudCredentialId: string,
    service: string,
    region: string | null,
    startDate: Date,
    endDate: Date,
  ): Promise<number[]> {
    const rows: DailySpendRow[] = await queryRunner.query(
      `SELECT usage_date, SUM(amount)::float AS amount
       FROM cost_line_items
       WHERE cloud_credential_id = $1 AND service = $2
         AND region IS NOT DISTINCT FROM $3
         AND usage_date >= $4 AND usage_date <= $5
       GROUP BY usage_date`,
      [cloudCredentialId, service, region, startDate, endDate],
    );
    return buildDailySpend(startDate, endDate, rows);
  }

  // ---- Recommendations (populated by CommitmentSweepService) ----

  listRecommendations(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM commitment_recommendations WHERE status = 'open' ORDER BY estimated_monthly_savings DESC`,
      ),
    );
  }

  async dismissRecommendation(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `UPDATE commitment_recommendations SET status = 'dismissed', updated_at = now() WHERE id = $1 RETURNING *`,
        [id],
      );
      if (!rows[0]) {
        throw new NotFoundException(
          `Commitment recommendation ${id} not found`,
        );
      }
      return rows[0];
    });
  }
}
