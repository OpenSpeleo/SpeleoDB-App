import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  nativeInit: vi.fn(),
  reactInit: vi.fn(),
}));

vi.mock('@sentry/capacitor', () => ({
  captureException: sentryMocks.captureException,
  init: sentryMocks.nativeInit,
}));

vi.mock('@sentry/react', () => ({
  init: sentryMocks.reactInit,
}));

import { captureSentryException, initSentry } from './sentry';

describe('Sentry diagnostic boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1');
  });

  it('drops transport breadcrumbs and strips user-shaped event fields', async () => {
    initSentry();
    await vi.waitFor(() => expect(sentryMocks.nativeInit).toHaveBeenCalledOnce());
    const options = sentryMocks.nativeInit.mock.calls[0][0];

    expect(options.beforeBreadcrumb({
      category: 'fetch',
      data: { token: 'secret' },
    })).toBeNull();

    const event = options.beforeSend({
      breadcrumbs: [{ message: 'Token breadcrumb-secret', data: { private: true } }],
      contexts: { private: { token: 'secret' } },
      exception: { values: [{ value: 'failed for user@example.com' }] },
      extra: { token: 'secret' },
      message: 'Authorization: Token event-secret',
      request: { headers: { Authorization: 'Token request-secret' } },
      user: { email: 'user@example.com' },
    });

    expect(event.user).toBeUndefined();
    expect(event.request).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.contexts).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('user@example.com');
    expect(event.breadcrumbs[0].data).toBeUndefined();
  });

  it('reports a newly created sanitized error without original payload fields', async () => {
    const error = Object.assign(new Error('Token raw-secret for user@example.com'), {
      payload: { coordinates: [12.3, -45.6] },
      token: 'raw-secret',
    });

    await captureSentryException(error, 'private component stack');

    expect(sentryMocks.captureException).toHaveBeenCalledOnce();
    const [captured, context] = sentryMocks.captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured).not.toBe(error);
    expect(captured.message).toBe('Token [REDACTED] for [REDACTED]');
    expect(captured).not.toHaveProperty('payload');
    expect(captured).not.toHaveProperty('token');
    expect(context).toEqual({ tags: { react_component_stack: 'available' } });
  });
});
