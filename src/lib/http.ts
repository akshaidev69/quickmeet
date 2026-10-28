const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init?.headers || {}) },
      ...init,
      signal: init?.signal || controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string; field?: string };
    if (!response.ok) {
      const err = new Error(data.error || `Request failed (${response.status})`) as Error & {
        field?: string;
        status?: number;
      };
      err.field = data.field;
      err.status = response.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('That took too long. Check your connection and retry.');
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}
