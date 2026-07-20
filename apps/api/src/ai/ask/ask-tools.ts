/**
 * Tool registry for the unified "Ask" assistant. Each tool wraps a GET call to
 * the app's own REST API, using X-Tenant-Id + X-Internal-Api-Key so the request
 * rides through the normal guard/RLS stack -- no direct service imports that
 * would violate the module-boundary discipline.
 */

export interface AskTool {
  name: string;
  description: string;
  paramsSchema: string; // freeform text for the AI prompt
}

export const ASK_TOOLS: AskTool[] = [
  {
    name: 'search_tickets',
    description: 'Search support tickets by keyword, status, or priority.',
    paramsSchema: '{"q": "string", "status": "string (optional)", "limit": "number (optional, max 20)"}',
  },
  {
    name: 'list_alerts',
    description: 'List monitoring alerts, optionally filtered by status (open/acknowledged/resolved).',
    paramsSchema: '{"status": "string (optional: open|acknowledged|resolved)"}',
  },
  {
    name: 'get_cost_summary',
    description: 'Get the month-to-date cloud cost summary (total spend, forecasts, open alerts).',
    paramsSchema: '{}',
  },
  {
    name: 'search_logs',
    description: 'Search log entries by keyword, level, and/or time range.',
    paramsSchema: '{"q": "string (optional)", "level": "string (optional: debug|info|warn|error)", "from": "ISO timestamp (optional)", "to": "ISO timestamp (optional)", "limit": "number (optional, max 50)"}',
  },
  {
    name: 'list_monitors',
    description: 'List configured monitors (uptime, ping, SSL, synthetic, etc.).',
    paramsSchema: '{}',
  },
];

export function buildToolsSystemPrompt(): string {
  const toolLines = ASK_TOOLS.map(
    (t) =>
      `  ${t.name}(${t.paramsSchema})\n    ${t.description}`,
  ).join('\n\n');

  return (
    'You are a cloud operations assistant with access to the following tools:\n\n' +
    toolLines +
    '\n\n' +
    'When you need to call a tool, respond with EXACTLY this format on its own line:\n' +
    'TOOL_CALL: {"tool": "<tool_name>", "args": {<args as JSON>}}\n\n' +
    'After receiving the tool result (prefixed with TOOL_RESULT:), continue reasoning. ' +
    'You may call multiple tools in sequence. ' +
    'When you have enough information to answer definitively, respond in plain text (no TOOL_CALL prefix). ' +
    'Be concise and actionable.'
  );
}

export interface ToolCallRequest {
  tool: string;
  args: Record<string, unknown>;
}

/** Parse a TOOL_CALL line. Returns null if the line is not a valid tool call. */
export function parseToolCall(line: string): ToolCallRequest | null {
  const prefix = 'TOOL_CALL:';
  if (!line.trimStart().startsWith(prefix)) return null;
  const json = line.trimStart().slice(prefix.length).trim();
  try {
    const parsed = JSON.parse(json) as { tool?: string; args?: Record<string, unknown> };
    if (typeof parsed.tool !== 'string') return null;
    return { tool: parsed.tool, args: parsed.args ?? {} };
  } catch {
    return null;
  }
}

/** True if this tool name is in the allowed registry (prevents prompt injection). */
export function isAllowedTool(name: string): boolean {
  return ASK_TOOLS.some((t) => t.name === name);
}
