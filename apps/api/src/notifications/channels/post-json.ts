/**
 * Minimal JSON POST used by the Slack and generic webhook channels. Node 22
 * ships a global fetch, so there's no HTTP dependency to add. A non-2xx
 * response throws so the dispatcher records the notification as failed
 * (with the reason) rather than silently marking it sent.
 */
export async function postJson(
  url: string,
  body: unknown,
  timeoutMs = 10000,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `POST ${url} returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
