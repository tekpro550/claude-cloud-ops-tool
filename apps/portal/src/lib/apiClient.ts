import type {
  PortalLoginResult,
  PortalTicket,
  PortalTicketDetail,
  Solution,
} from "../types/portal";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Set by AuthProvider on login/logout/register.
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const message = payload?.message ?? res.statusText;
    throw new ApiError(Array.isArray(message) ? message.join(", ") : message, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

/** Guest-accessible requests: tenant-scoped, no login required (submit ticket, browse solutions). */
function guestRequest<T>(tenantId: string, method: string, path: string, body?: unknown): Promise<T> {
  return fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(handle<T>);
}

/** Requires a logged-in contact -- Bearer token only, no X-Tenant-Id fallback (matches the backend's PortalAuthGuard). */
function authedRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  return fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(handle<T>);
}

export function register(tenantId: string, input: { name: string; email: string; password: string }): Promise<PortalLoginResult> {
  return guestRequest(tenantId, "POST", "/portal/auth/register", input);
}

export function login(tenantId: string, input: { email: string; password: string }): Promise<PortalLoginResult> {
  return guestRequest(tenantId, "POST", "/portal/auth/login", input);
}

export function getMe(): Promise<{ id: string; name: string; email: string }> {
  return authedRequest("GET", "/portal/auth/me");
}

export interface SubmitTicketInput {
  name: string;
  email: string;
  subject: string;
  description: string;
  priority?: string;
}

export function submitTicket(tenantId: string, input: SubmitTicketInput): Promise<PortalTicketDetail> {
  return guestRequest(tenantId, "POST", "/portal/tickets", input);
}

export function listMyTickets(): Promise<PortalTicket[]> {
  return authedRequest("GET", "/portal/tickets");
}

export function getMyTicket(id: string): Promise<PortalTicketDetail> {
  return authedRequest("GET", `/portal/tickets/${id}`);
}

export function listSolutions(tenantId: string): Promise<Solution[]> {
  return guestRequest(tenantId, "GET", "/portal/solutions");
}

export function getSolution(tenantId: string, id: string): Promise<Solution> {
  return guestRequest(tenantId, "GET", `/portal/solutions/${id}`);
}

// Deliberately not calling the agent-facing /search endpoint here: it's
// guarded only by X-Tenant-Id (same as every other agent route, pending
// real per-endpoint authorization) and returns tickets/contacts/companies
// across the whole tenant, none of which a portal visitor should ever be
// able to reach. Portal "search" is filtered client-side over the
// already-published-only /portal/solutions list instead.
export function searchSolutions(solutions: Solution[], q: string): Solution[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return solutions.filter(
    (s) => s.title.toLowerCase().includes(needle) || s.body.toLowerCase().includes(needle),
  );
}
