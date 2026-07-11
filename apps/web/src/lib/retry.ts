const TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504]);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

export function isRetryableApiFailure(error: unknown): boolean {
  if (error instanceof ApiError) {
    return isTransientHttpStatus(error.status);
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }
  return false;
}

export function isRetryablePlaybackFailure(error: unknown): boolean {
  if (isRetryableApiFailure(error)) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("failed to load audio")) return true;
    if (message.includes("could not play")) return true;
    if (message.includes("server may still be preparing")) return true;
  }
  return false;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const shouldRetry = options.shouldRetry ?? isRetryableApiFailure;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter = delay * 0.2 * Math.random();
      await sleep(delay + jitter);
    }
  }
  throw lastError;
}
