import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  ListRecommendationsQueryDto,
  UpdateRecommendationDto,
} from './recommendations.dto';

/**
 * List/dismiss/resolve plus the recommendation-to-ticket action (scope doc
 * section 4). create_ticket calls the existing
 * /internal/tickets/from_alert contract with a recommendation-shaped
 * payload -- same internal HTTP call AlertEvaluationService already makes,
 * not a new internal endpoint, and the same "idempotent per subject, ticket
 * id set once" rule alerts.ticket_id uses.
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  list(tenantId: string, filters: ListRecommendationsQueryDto) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filters.resourceId) {
        params.push(filters.resourceId);
        conditions.push(`resource_id = $${params.length}`);
      }
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`status = $${params.length}`);
      }
      if (filters.type) {
        params.push(filters.type);
        conditions.push(`recommendation_type = $${params.length}`);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';
      return queryRunner.query(
        `SELECT * FROM rightsizing_recommendations ${where} ORDER BY created_at DESC`,
        params,
      );
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRecommendationDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `UPDATE rightsizing_recommendations SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, dto.status],
      );
      if (!rows || rows.length === 0) {
        throw new NotFoundException(`Recommendation ${id} not found`);
      }
      return rows[0];
    });
  }

  async createTicket(tenantId: string, id: string) {
    const recommendation = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT rr.*, r.name AS resource_name FROM rightsizing_recommendations rr
           JOIN resources r ON r.id = rr.resource_id
           WHERE rr.id = $1`,
          [id],
        );
        return row;
      },
    );
    if (!recommendation) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }
    if (recommendation.ticket_id) {
      // Idempotent: a recommendation already linked to a ticket just
      // returns that ticket instead of erroring or creating a second one.
      return { ticketId: recommendation.ticket_id };
    }
    if (recommendation.status !== 'open') {
      throw new BadRequestException(
        `Recommendation ${id} is ${recommendation.status}, not open`,
      );
    }

    const ticket = await this.callInternalApi('/internal/tickets/from_alert', {
      tenantId,
      subject: `[Cost] ${recommendation.resource_name}: ${recommendation.recommendation_type} recommendation`,
      description: recommendation.reason_text,
      resourceId: recommendation.resource_id,
      priority: 'medium',
    });
    if (!ticket?.id) {
      throw new BadRequestException(
        'Ticket creation failed -- recommendation left open',
      );
    }

    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `UPDATE rightsizing_recommendations SET status = 'ticket_created', ticket_id = $2, updated_at = now() WHERE id = $1`,
        [id, ticket.id],
      ),
    );

    return { ticketId: ticket.id };
  }

  private async callInternalApi(
    path: string,
    body: Record<string, unknown>,
  ): Promise<any> {
    const baseUrl = this.config.get<string>(
      'INTERNAL_API_BASE_URL',
      'http://localhost:3000/api/v1',
    );
    const apiKey = this.config.get<string>(
      'INTERNAL_API_KEY',
      'dev-internal-api-key',
    );

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      this.logger.error(
        `internal call to ${path} failed with status ${response.status}: ${await response.text()}`,
      );
      return null;
    }
    return response.json();
  }
}
