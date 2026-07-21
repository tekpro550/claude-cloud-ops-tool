import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';

@Injectable()
export class TicketTriageService {
  private readonly logger = new Logger(TicketTriageService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
    private readonly config: ConfigService,
  ) {}

  /** Called fire-and-forget from TicketsService.create after commit. */
  async triageTicket(tenantId: string, ticketId: string): Promise<void> {
    try {
      const mode = await this.getTriageMode(tenantId);
      if (mode === 'off') return;

      const client =
        (await this.settings.resolveClient(tenantId)) ?? this.envClient;
      if (!client.enabled) return;

      const allowlists = await this.loadAllowlists(tenantId);
      const ticket = await this.loadTicket(tenantId, ticketId);
      if (!ticket) return;

      const system = this.buildSystemPrompt(allowlists);
      const user = `Subject: ${ticket.subject}\n\n${ticket.first_message ?? '(no body)'}`;

      let raw: string;
      try {
        raw = await client.complete(system, user);
      } catch (err) {
        this.logger.warn(
          `triage AI call failed for ticket ${ticketId}: ${(err as Error).message}`,
        );
        return;
      }

      const suggestion = this.parseSuggestion(raw, allowlists);

      await withTenantContext(this.dataSource, tenantId, async (qr) => {
        const [triageRow] = await qr.query(
          `INSERT INTO ticket_ai_triage (tenant_id, ticket_id, suggested_priority, suggested_type_id, suggested_tags, suggested_skill, rationale, model)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            tenantId,
            ticketId,
            suggestion.priority,
            suggestion.typeId,
            suggestion.tags,
            suggestion.skill,
            suggestion.rationale,
            'ai',
          ],
        );

        if (mode === 'apply') {
          const sets: string[] = [];
          const params: unknown[] = [];
          const set = (col: string, val: unknown) => {
            params.push(val);
            sets.push(`${col} = $${params.length}`);
          };
          if (suggestion.priority) set('priority', suggestion.priority);
          if (suggestion.typeId) set('ticket_type_id', suggestion.typeId);
          if (suggestion.tags.length > 0) set('tags', suggestion.tags);
          if (sets.length > 0) {
            params.push(ticketId);
            await qr.query(
              `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${params.length}`,
              params,
            );
            // Mark the row we just inserted as applied (Postgres UPDATE has no
            // ORDER BY/LIMIT, so target it by its returned primary key).
            await qr.query(
              `UPDATE ticket_ai_triage SET applied = true WHERE id = $1`,
              [triageRow.id],
            );
          }
        }
      });
    } catch (err) {
      this.logger.error(
        `triage failed for ticket ${ticketId}: ${(err as Error).message}`,
      );
    }
  }

  async getTriageSuggestion(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [row] = await qr.query(
        `SELECT * FROM ticket_ai_triage WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [ticketId],
      );
      return row ?? null;
    });
  }

  private async getTriageMode(tenantId: string): Promise<string> {
    // Must run inside the tenant context: tenant_ai_settings has FORCE RLS, so a
    // bare dataSource.query (no app.current_tenant set) matches zero rows and the
    // tenant's configured mode would be silently ignored.
    const rows = await withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(
        `SELECT auto_triage_mode FROM tenant_ai_settings WHERE tenant_id = $1`,
        [tenantId],
      ),
    );
    return (
      rows[0]?.auto_triage_mode ??
      this.config.get('AI_TRIAGE_DEFAULT_MODE', 'off')
    );
  }

  private async loadTicket(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const rows = await qr.query(
        `SELECT t.subject, tm.body AS first_message
         FROM tickets t
         LEFT JOIN ticket_messages tm ON tm.ticket_id = t.id
         WHERE t.id = $1
         ORDER BY tm.created_at ASC NULLS LAST
         LIMIT 1`,
        [ticketId],
      );
      return rows[0] ?? null;
    });
  }

  private async loadAllowlists(tenantId: string): Promise<{
    priorities: string[];
    types: { id: string; name: string }[];
    skills: string[];
    tags: string[];
  }> {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const priorities = ['low', 'medium', 'high', 'urgent'];
      const types: { id: string; name: string }[] = await qr.query(
        `SELECT id, name FROM ticket_types ORDER BY name`,
      );
      const skills: { value: string }[] = await qr.query(
        `SELECT DISTINCT required_skill AS value FROM tickets WHERE required_skill IS NOT NULL LIMIT 50`,
      );
      const tags: { value: string }[] = await qr.query(
        `SELECT DISTINCT unnest(tags) AS value FROM tickets LIMIT 100`,
      );
      return {
        priorities,
        types,
        skills: skills.map((s) => s.value),
        tags: tags.map((t) => t.value),
      };
    });
  }

  private buildSystemPrompt(allowlists: {
    priorities: string[];
    types: { id: string; name: string }[];
    skills: string[];
    tags: string[];
  }): string {
    const typeList =
      allowlists.types.map((t) => `${t.id}:${t.name}`).join(', ') || 'none';
    const skillList = allowlists.skills.join(', ') || 'none';
    const tagList = allowlists.tags.join(', ') || 'none';
    return [
      'You are a support-ticket triage assistant. Given a ticket subject and first message, output ONLY valid JSON with these fields:',
      '{ "priority": one of [' +
        allowlists.priorities.map((p) => `"${p}"`).join(',') +
        '] or null,',
      '  "typeId": one of [' +
        allowlists.types.map((t) => `"${t.id}"`).join(',') +
        '] or null,',
      '  "tags": array of strings from [' +
        tagList +
        '] (empty array if none fit),',
      '  "skill": one of [' + skillList + '] or null,',
      '  "rationale": brief sentence explaining your choices }',
      'Type IDs available: ' + typeList,
      'Only use values from the allowed lists. Return null for fields you cannot confidently fill. Output JSON only.',
    ].join('\n');
  }

  private parseSuggestion(
    raw: string,
    allowlists: {
      priorities: string[];
      types: { id: string }[];
      skills: string[];
      tags: string[];
    },
  ): {
    priority: string | null;
    typeId: string | null;
    tags: string[];
    skill: string | null;
    rationale: string;
  } {
    const empty = {
      priority: null,
      typeId: null,
      tags: [] as string[],
      skill: null,
      rationale: '',
    };
    try {
      const json = raw.match(/\{[\s\S]*\}/)?.[0];
      if (!json) return empty;
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const typeIds = new Set(allowlists.types.map((t) => t.id));
      const skillSet = new Set(allowlists.skills);
      const tagSet = new Set(allowlists.tags);
      return {
        priority: allowlists.priorities.includes(String(parsed.priority ?? ''))
          ? String(parsed.priority)
          : null,
        typeId: typeIds.has(String(parsed.typeId ?? ''))
          ? String(parsed.typeId)
          : null,
        tags: Array.isArray(parsed.tags)
          ? (parsed.tags as unknown[])
              .filter((t) => tagSet.has(String(t)))
              .map(String)
          : [],
        skill: skillSet.has(String(parsed.skill ?? ''))
          ? String(parsed.skill)
          : null,
        rationale:
          typeof parsed.rationale === 'string'
            ? parsed.rationale.slice(0, 500)
            : '',
      };
    } catch {
      return empty;
    }
  }
}
