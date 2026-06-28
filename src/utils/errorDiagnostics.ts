const REDACTED = '[REDACTED]';
const MAX_DIAGNOSTIC_TEXT_LENGTH = 512;
const MAX_DIAGNOSTIC_DEPTH = 4;
const MAX_DIAGNOSTIC_KEYS = 24;

const SENSITIVE_KEY = /(?:^|_)(?:authorization|cookie|credentials?|password|secret|token|body|data|payload|headers?|email|user(?:name)?|latitude|longitude|altitude|coordinates?|geometry|project_?name|track_?name)(?:$|_)/i;
const IDENTIFIER_KEY = /(?:^id$|Id$|_id$)/;

/** Redact secret- and user-shaped text before it reaches a console or reporter. */
export function redactDiagnosticText(value: string): string {
  const redacted = value
    .replace(/\b(Authorization\s*[:=]\s*)(?:Token|Bearer)\s+[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/\b(Token|Bearer)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(/\b(password|secret|token|cookie)\s*[:=]\s*[^\s,;&]+/gi, `$1=${REDACTED}`)
    .replace(/([?&#](?:access_?token|auth|code|password|secret|signature|token)=)[^&#\s]*/gi, `$1${REDACTED}`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, REDACTED)
    .replace(/\b[0-9a-f]{32,64}\b/gi, REDACTED)
    .replace(/\b(-?\d{1,3}\.\d{4,}\s*[,/]\s*-?\d{1,3}\.\d{4,})\b/g, REDACTED)
    .replace(/\b((?:project|track|target|commit)(?:\s+(?:id|name))?\s+(?:for\s+)?)\S+/gi, `$1${REDACTED}`)
    .replace(/("(?:email|user(?:name)?|project(?:Id|Name)?|track(?:Id|Name)?|commitId)"\s*:\s*)"[^"]*"/gi, `$1"${REDACTED}"`)
    .replace(/("(?:latitude|longitude|altitude|coordinates?)"\s*:\s*)[^,}\]]+/gi, `$1"${REDACTED}"`)
    .replace(/(https?:\/\/[^/\s?#]+)(?:\/[^\s]*)?/gi, `$1/${REDACTED}`);

  if (redacted.length <= MAX_DIAGNOSTIC_TEXT_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)}…[TRUNCATED]`;
}

function isSensitiveDiagnosticKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || IDENTIFIER_KEY.test(key);
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return `[${typeof value}]`;
  }
  if (value instanceof Error) return errorToLogDetails(value, seen, depth);
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DIAGNOSTIC_DEPTH) return '[max-depth]';

  seen.add(value);
  try {
    const result: Record<string, unknown> = {};
    const keys = Object.keys(value).slice(0, MAX_DIAGNOSTIC_KEYS);
    for (const key of keys) {
      result[key] = isSensitiveDiagnosticKey(key)
        ? REDACTED
        : sanitizeValue((value as Record<string, unknown>)[key], seen, depth + 1);
    }
    if (Object.keys(value).length > keys.length) result.truncated = true;
    return result;
  } catch {
    return '[unavailable]';
  }
}

/** Convert arbitrary diagnostics into a bounded, serializable, redacted value. */
export function sanitizeDiagnosticValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>(), 0);
}

/** Convert thrown values into bounded diagnostics without stack or payload data. */
export function errorToLogDetails(
  error: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { thrown: sanitizeValue(error, seen, depth) };
  }
  if (seen.has(error)) return { error: '[circular]' };
  seen.add(error);

  const details: Record<string, unknown> = {
    name: redactDiagnosticText(error.name || 'Error'),
    message: redactDiagnosticText(error.message || 'Unknown error'),
  };
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') {
    details.code = sanitizeValue(code, seen, depth + 1);
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined && depth < MAX_DIAGNOSTIC_DEPTH) {
    details.cause = errorToLogDetails(cause, seen, depth + 1);
  }
  return details;
}

/** Create a reporter-safe error with no original stack, cause, or enumerable data. */
export function toSafeDiagnosticError(error: unknown): Error {
  const details = errorToLogDetails(error);
  const safe = new Error(String(details.message ?? 'Unknown error'));
  safe.name = String(details.name ?? 'Error');
  return safe;
}

type DiagnosticConsole = Pick<Console, 'debug' | 'error' | 'info' | 'log' | 'warn'>;
const protectedConsoles = new WeakSet<object>();

/** Install one process-wide redaction boundary for all application console calls. */
export function installDiagnosticRedaction(target: DiagnosticConsole = console): void {
  if (protectedConsoles.has(target)) return;
  protectedConsoles.add(target);

  for (const method of ['debug', 'error', 'info', 'log', 'warn'] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      original(...args.map(sanitizeDiagnosticValue));
    };
  }
}
