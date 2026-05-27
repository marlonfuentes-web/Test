import logger from './logger';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 200,
  maxDelayMs: 5000,
};

export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  label = 'operation'
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === opts.maxAttempts) break;

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs
      );

      if (opts.onRetry) {
        opts.onRetry(attempt, lastError);
      } else {
        logger.warn(`${label} failed (attempt ${attempt}/${opts.maxAttempts}): ${lastError.message}. Retrying in ${delay}ms...`);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
