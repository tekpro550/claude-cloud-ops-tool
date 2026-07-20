import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../ai-completion.client';
import { TenantAiSettingsService } from '../tenant-ai-settings.service';
import {
  buildToolsSystemPrompt,
  isAllowedTool,
  parseToolCall,
  ToolCallRequest,
} from './ask-tools';

const MAX_TOOL_ROUNDS = 6; // max tool calls per single user message

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly aiSettings: TenantAiSettingsService,
    private readonly config: ConfigService,
  ) {}

  async createSession(tenantId: string): Promise<{ id: string }> {
    const [session] = await withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(
        `INSERT INTO ask_sessions (tenant_id) VALUES ($1) RETURNING id`,
        [tenantId],
      ),
    );
    return { id: session.id };
  }

  async getMessages(tenantId: string, sessionId: string) {
    const messages = await withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(
        `SELECT id, role, content, tool_calls, created_at
           FROM ask_messages
           WHERE session_id = $1
           ORDER BY created_at ASC`,
        [sessionId],
      ),
    );
    // Verify session belongs to tenant (the RLS-filtered query returns [] if not)
    const [session] = await withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(`SELECT id FROM ask_sessions WHERE id = $1`, [sessionId]),
    );
    if (!session)
      throw new NotFoundException(`Ask session ${sessionId} not found`);
    return messages;
  }

  async ask(
    tenantId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<{ role: 'assistant'; content: string }> {
    if (!userMessage || userMessage.trim().length === 0) {
      throw new BadRequestException('message must not be empty');
    }
    if (userMessage.length > 4000) {
      throw new BadRequestException('message must be at most 4000 characters');
    }

    // Verify session exists under this tenant
    const [session] = await withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(`SELECT id FROM ask_sessions WHERE id = $1`, [sessionId]),
    );
    if (!session)
      throw new NotFoundException(`Ask session ${sessionId} not found`);

    const client =
      (await this.aiSettings.resolveClient(tenantId)) ?? this.envClient;
    if (!client.enabled) {
      throw new BadRequestException(
        'AI assist is not configured for this tenant',
      );
    }

    // Persist user message
    await this.saveMessage(tenantId, sessionId, 'user', userMessage, null);

    // Load conversation history for context (last 20 messages)
    const history: Array<{ role: string; content: string }> =
      await withTenantContext(this.dataSource, tenantId, (qr) =>
        qr.query(
          `SELECT role, content FROM ask_messages
           WHERE session_id = $1
           ORDER BY created_at ASC
           LIMIT 20`,
          [sessionId],
        ),
      );

    // Run tool-use loop
    const { answer, toolCallLog } = await this.runLoop(
      tenantId,
      client,
      history,
    );

    // Persist assistant message
    await this.saveMessage(
      tenantId,
      sessionId,
      'assistant',
      answer,
      toolCallLog.length > 0 ? toolCallLog : null,
    );

    return { role: 'assistant', content: answer };
  }

  /**
   * Tool-use loop: up to MAX_TOOL_ROUNDS round-trips where the AI can call a
   * tool and receive its result before giving its final answer. Prompt
   * engineering rather than native function-calling, so it works uniformly
   * across all supported backends.
   */
  private async runLoop(
    tenantId: string,
    client: AiCompletionClient,
    history: Array<{ role: string; content: string }>,
  ): Promise<{ answer: string; toolCallLog: ToolCallRequest[] }> {
    const system = buildToolsSystemPrompt();
    const toolCallLog: ToolCallRequest[] = [];

    // Build a single combined user prompt from conversation history
    let conversationText = history
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const raw = await client.complete(system, conversationText);
      const trimmed = raw.trim();

      // Look for a TOOL_CALL directive on the first meaningful line
      const firstLine =
        trimmed.split('\n').find((l) => l.trim().length > 0) ?? '';
      const toolCall = parseToolCall(firstLine);

      if (!toolCall) {
        // Final answer
        return { answer: trimmed, toolCallLog };
      }

      if (!isAllowedTool(toolCall.tool)) {
        this.logger.warn(
          `Ask assistant requested unknown tool: ${toolCall.tool}`,
        );
        conversationText +=
          `\n\nAssistant: TOOL_CALL: ${JSON.stringify(toolCall)}` +
          `\n\nTOOL_RESULT: Error: unknown tool "${toolCall.tool}"`;
        continue;
      }

      toolCallLog.push(toolCall);
      const result = await this.callTool(tenantId, toolCall);
      conversationText +=
        `\n\nAssistant: TOOL_CALL: ${JSON.stringify(toolCall)}` +
        `\n\nTOOL_RESULT: ${result}`;
    }

    // Exhausted rounds — ask for a final answer without tools
    const final = await client.complete(
      system +
        '\n\nYou have reached the tool call limit. Summarize what you have learned so far and give your best answer.',
      conversationText,
    );
    return { answer: final.trim(), toolCallLog };
  }

  /**
   * Execute a single tool by calling the app's own REST API via HTTP. This is
   * the same pattern AlertEvaluationService uses to call /internal/tickets —
   * in-process HTTP keeps the module boundary clean.
   */
  private async callTool(
    tenantId: string,
    call: ToolCallRequest,
  ): Promise<string> {
    try {
      const result = await this.fetchInternal(tenantId, call.tool, call.args);
      return JSON.stringify(result).slice(0, 4000); // cap tool result size
    } catch (err) {
      this.logger.warn(
        `Ask tool ${call.tool} failed: ${(err as Error).message}`,
      );
      return `Error: ${(err as Error).message}`;
    }
  }

  private async fetchInternal(
    tenantId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const baseUrl = this.config.get<string>(
      'INTERNAL_API_BASE_URL',
      'http://localhost:3000/api/v1',
    );
    const apiKey = this.config.get<string>(
      'INTERNAL_API_KEY',
      'dev-internal-api-key',
    );
    const headers = {
      'X-Tenant-Id': tenantId,
      'X-Internal-Api-Key': apiKey,
    };

    let url: string;
    switch (tool) {
      case 'search_tickets': {
        const params = new URLSearchParams();
        if (args.q) params.set('q', String(args.q));
        if (args.status) params.set('status', String(args.status));
        if (args.limit)
          params.set('limit', String(Math.min(Number(args.limit), 20)));
        url = `${baseUrl}/tickets?${params}`;
        break;
      }
      case 'list_alerts': {
        const params = new URLSearchParams();
        if (args.status) params.set('status', String(args.status));
        url = `${baseUrl}/alerts?${params}`;
        break;
      }
      case 'get_cost_summary':
        url = `${baseUrl}/cost/dashboard/summary`;
        break;
      case 'search_logs': {
        const params = new URLSearchParams();
        if (args.q) params.set('q', String(args.q));
        if (args.level) params.set('level', String(args.level));
        if (args.from) params.set('from', String(args.from));
        if (args.to) params.set('to', String(args.to));
        if (args.limit)
          params.set('limit', String(Math.min(Number(args.limit), 50)));
        url = `${baseUrl}/logs/search?${params}`;
        break;
      }
      case 'list_monitors':
        url = `${baseUrl}/monitors`;
        break;
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`${tool} returned HTTP ${response.status}`);
    }
    return response.json();
  }

  private async saveMessage(
    tenantId: string,
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    toolCalls: ToolCallRequest[] | null,
  ): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(
        `INSERT INTO ask_messages (tenant_id, session_id, role, content, tool_calls)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantId,
          sessionId,
          role,
          content,
          toolCalls ? JSON.stringify(toolCalls) : null,
        ],
      ),
    );
  }
}
