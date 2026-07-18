import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { CommitmentsService } from '../commitments/commitments.service';
import { CostAllocationService } from '../cost-allocation.service';
import { CostDashboardService } from '../cost-dashboard.service';
import { ReportTable } from './report-export';

export const REPORT_KINDS = [
  'cost_dashboard',
  'cost_by_service',
  'cost_by_tag',
  'commitment_coverage',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * report_kind -> ReportTable. Reuses the same tested services the API's own
 * dashboards call (CostDashboardService, CostAllocationService,
 * CommitmentsService) rather than re-deriving their SQL, so a report matches
 * what the UI shows. All four current kinds are cost-module data; a
 * ticket-sourced kind (the report builder, task 7) would have to reach
 * Ticketing over its internal HTTP contract like every other cross-module
 * call in this codebase -- not a direct import of a Ticketing service here.
 */
@Injectable()
export class ReportGeneratorService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly costDashboard: CostDashboardService,
    private readonly costAllocation: CostAllocationService,
    private readonly commitments: CommitmentsService,
  ) {}

  async generate(
    tenantId: string,
    reportKind: string,
    params: Record<string, unknown>,
  ): Promise<ReportTable> {
    switch (reportKind as ReportKind) {
      case 'cost_dashboard':
        return this.costDashboardTable(tenantId);
      case 'cost_by_service':
        return this.costByServiceTable(tenantId);
      case 'cost_by_tag':
        return this.costByTagTable(tenantId, params);
      case 'commitment_coverage':
        return this.commitmentCoverageTable(tenantId);
      default:
        throw new BadRequestException(`Unknown report kind "${reportKind}"`);
    }
  }

  private async costDashboardTable(tenantId: string): Promise<ReportTable> {
    const summary = await this.costDashboard.summary(tenantId);
    return {
      title: 'Cost Dashboard Summary',
      columns: ['Metric', 'Value'],
      rows: [
        ['Month to date', summary.mtdSpend.toFixed(2)],
        ['Previous month', summary.previousMonthTotal?.toFixed(2) ?? '—'],
        ['Forecast (full month)', summary.forecast?.toFixed(2) ?? '—'],
        ['Connected accounts', summary.connectedAccounts],
        ['Open budget alerts', summary.openBudgetAlerts],
        ['Open recommendations', summary.openRecommendations],
      ],
    };
  }

  private async costByServiceTable(tenantId: string): Promise<ReportTable> {
    const rows = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(`
          SELECT service, SUM(amount)::float AS amount
          FROM cost_line_items
          WHERE usage_date >= date_trunc('month', now())::date
          GROUP BY service
          ORDER BY amount DESC
        `),
    );
    return {
      title: 'Cost by Service (month to date)',
      columns: ['Service', 'Amount'],
      rows: rows.map((r: { service: string; amount: number }) => [
        r.service,
        r.amount.toFixed(2),
      ]),
    };
  }

  private async costByTagTable(
    tenantId: string,
    params: Record<string, unknown>,
  ): Promise<ReportTable> {
    const tagKey = params.tagKey;
    if (typeof tagKey !== 'string' || !tagKey) {
      throw new BadRequestException(
        'cost_by_tag reports require a params.tagKey',
      );
    }
    const result = await this.costAllocation.allocationByTag(tenantId, tagKey);
    return {
      title: `Cost by Tag: ${tagKey} (month to date)`,
      columns: [tagKey, 'Amount'],
      rows: result.rows.map((r) => [r.tagValue, r.amount.toFixed(2)]),
    };
  }

  private async commitmentCoverageTable(
    tenantId: string,
  ): Promise<ReportTable> {
    const owned = await this.commitments.list(tenantId);
    const rows: (string | number)[][] = [];
    for (const commitment of owned) {
      const result = await this.commitments.getCoverage(
        tenantId,
        commitment.id,
      );
      rows.push([
        commitment.service,
        commitment.region ?? '—',
        commitment.kind,
        Number(commitment.hourly_commitment).toFixed(2),
        result.coverage ? `${result.coverage.coveragePct.toFixed(1)}%` : '—',
        result.utilization
          ? `${result.utilization.utilizationPct.toFixed(1)}%`
          : '—',
        result.utilization ? result.utilization.wastedAmount.toFixed(2) : '—',
      ]);
    }
    return {
      title: 'Commitment Coverage & Utilization',
      columns: [
        'Service',
        'Region',
        'Kind',
        'Hourly $',
        'Coverage',
        'Utilization',
        'Wasted $',
      ],
      rows,
    };
  }
}
