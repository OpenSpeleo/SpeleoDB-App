/**
 * Convert thrown values into console-friendly diagnostics. Native console bridges
 * often print `Error` objects as `{}`, so log plain serializable fields instead.
 */
export function errorToLogDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    const withCause = error as Error & { cause?: unknown };
    if (withCause.cause !== undefined) {
      details.cause = errorToLogDetails(withCause.cause);
    }
    for (const key of Object.keys(error)) {
      details[key] = (error as unknown as Record<string, unknown>)[key];
    }
    return details;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const details: Record<string, unknown> = {
      type: 'object',
      constructorName: error.constructor?.name,
      keys: Object.keys(record),
    };
    for (const key of ['name', 'message', 'code', 'stack']) {
      if (record[key] !== undefined) details[key] = record[key];
    }
    return details;
  }

  return { type: typeof error, value: error };
}
