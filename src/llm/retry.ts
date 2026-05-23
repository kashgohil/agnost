// Exponential-backoff retry for transient LLM transport errors.
//
// Scope: rate limits (429), upstream 5xx, network errors. Does NOT retry on
// 4xx (those indicate a bad request — retrying won't help) or on content
// validation failures (those are handled by callers with corrective prompts).

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 8_000;

export async function withLlmRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) throw err;
      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS) + Math.random() * 500;
      process.stderr.write(`\n[llm retry ${attempt}/${MAX_ATTEMPTS - 1}] ${describeError(err)} — waiting ${Math.round(delay)}ms\n`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string };
  if (typeof e.status === "number" && (e.status === 429 || e.status >= 500)) return true;
  if (e.code === "ETIMEDOUT" || e.code === "ECONNRESET" || e.code === "ECONNREFUSED") return true;
  return false;
}

function describeError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { status?: number; code?: string; message?: string };
  if (e.status) return `HTTP ${e.status}`;
  if (e.code) return e.code;
  return e.message ?? "unknown";
}
