import { describe, expect, it, vi } from 'vitest';

import {
  errorToLogDetails,
  installDiagnosticRedaction,
  redactDiagnosticText,
  sanitizeDiagnosticValue,
  toSafeDiagnosticError,
} from './errorDiagnostics';

describe('diagnostic redaction', () => {
  it('redacts credentials, emails, URL secrets, and coordinates from text', () => {
    const input = 'Authorization: Token abc user@example.com https://x.test/private/a?token=xyz '
      + 'project 123e4567-e89b-42d3-a456-426614174000 at 12.34567,-45.67891 '
      + '{"latitude":12.3,"longitude":-45.6,"trackName":"Private cave"}';

    const output = redactDiagnosticText(input);

    expect(output).not.toContain('abc');
    expect(output).not.toContain('user@example.com');
    expect(output).not.toContain('xyz');
    expect(output).not.toContain('12.3');
    expect(output).not.toContain('-45.6');
    expect(output).not.toContain('123e4567-e89b-42d3-a456-426614174000');
    expect(output).not.toContain('Private cave');
    expect(output).not.toContain('/private/a');
    expect(output).toContain('[REDACTED]');
  });

  it('bounds diagnostic strings', () => {
    expect(redactDiagnosticText('x'.repeat(600))).toHaveLength(524);
    expect(redactDiagnosticText('x'.repeat(600)).endsWith('…[TRUNCATED]')).toBe(true);
  });

  it('redacts secret, identifier, user, coordinate, and payload-shaped object fields', () => {
    const sanitized = sanitizeDiagnosticValue({
      phase: 'upload',
      token: 'secret',
      trackId: 'track-1',
      trackName: 'Private cave',
      latitude: 12.3,
      payload: { private: true },
      nested: { email: 'user@example.com', safe: 'retained' },
      items: [1, 2, 3],
    });

    expect(sanitized).toEqual({
      phase: 'upload',
      token: '[REDACTED]',
      trackId: '[REDACTED]',
      trackName: '[REDACTED]',
      latitude: '[REDACTED]',
      payload: '[REDACTED]',
      nested: { email: '[REDACTED]', safe: 'retained' },
      items: '[array:3]',
    });
  });

  it('emits only sanitized error name, message, code, and cause', () => {
    const cause = Object.assign(new Error('Token child-secret'), { payload: 'private' });
    const error = Object.assign(new Error('failed for user@example.com'), {
      code: 'E_PRIVATE',
      cause,
      token: 'top-secret',
    });

    expect(errorToLogDetails(error)).toEqual({
      name: 'Error',
      message: 'failed for [REDACTED]',
      code: 'E_PRIVATE',
      cause: { name: 'Error', message: 'Token [REDACTED]' },
    });
    const safe = toSafeDiagnosticError(error);
    expect(safe.name).toBe('Error');
    expect(safe.message).toBe('failed for [REDACTED]');
    expect(safe).not.toHaveProperty('cause');
    expect(safe).not.toHaveProperty('token');
  });

  it('handles circular and inaccessible values without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sanitizeDiagnosticValue(circular)).toEqual({ self: '[circular]' });

    const inaccessible = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => { throw new Error('private getter'); },
    });
    expect(sanitizeDiagnosticValue(inaccessible)).toBe('[unavailable]');
  });

  it('wraps each console method once and sanitizes every argument', () => {
    const target = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    };
    const originalWarn = target.warn;

    installDiagnosticRedaction(target);
    installDiagnosticRedaction(target);
    target.warn('Token raw-secret', { longitude: -45.6, safe: true });

    expect(originalWarn).toHaveBeenCalledOnce();
    expect(originalWarn).toHaveBeenCalledWith(
      'Token [REDACTED]',
      { longitude: '[REDACTED]', safe: true },
    );
  });
});
