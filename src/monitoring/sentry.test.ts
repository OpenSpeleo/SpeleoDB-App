import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClient, defaultStackParser } from '@sentry/browser';
import type { Transport } from '@sentry/core';

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
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('diagnostic-test-runtime');
  });

  afterEach(() => vi.restoreAllMocks());

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

  it('reports original bundled frames and component locations without payload fields', async () => {
    const error = Object.assign(new Error('Token raw-secret for user@example.com'), {
      payload: { coordinates: [12.3, -45.6] },
      token: 'raw-secret',
    });
    error.stack = 'Error: Token raw-secret for user@example.com\n'
      + '    at renderMap (https://www.speleodb.org/assets/Dashboard-AbCd1234.js:11:80764)\n'
      + '    at fetch (https://private.test/api/user@example.com?token=raw-secret:1:2)';

    await captureSentryException(error,
      '\n    at Dashboard (https://www.speleodb.org/assets/Dashboard-AbCd1234.js:15:1878)\n'
      + '    at Private (https://private.test/user@example.com?token=raw-secret:1:2)');

    expect(sentryMocks.captureException).toHaveBeenCalledOnce();
    const [captured, context] = sentryMocks.captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured).not.toBe(error);
    expect(captured.message).toBe('Token [REDACTED] for [REDACTED]');
    expect(captured).not.toHaveProperty('payload');
    expect(captured).not.toHaveProperty('token');
    expect(captured.stack).toBe('Error: Token [REDACTED] for [REDACTED]\n'
      + '    at renderMap (/assets/Dashboard-AbCd1234.js:11:80764)');
    expect(context).toEqual({
      tags: { react_component_stack: 'available' },
      contexts: { react: { componentStack: '    at Dashboard (/assets/Dashboard-AbCd1234.js:15:1878)' } },
    });
    // Exercise the final SDK event boundary too: it previously deleted this context.
    initSentry();
    await vi.waitFor(() => expect(sentryMocks.nativeInit).toHaveBeenCalledOnce());
    const event = sentryMocks.nativeInit.mock.calls[0][0].beforeSend({
      contexts: { ...context.contexts, private: { token: 'raw-secret' } },
      exception: { values: [{ value: captured.message, stacktrace: { frames: [{
        filename: 'https://www.speleodb.org/assets/Dashboard-AbCd1234.js?token=raw-secret',
        function: 'renderMap', lineno: 11, colno: 80764,
        vars: { token: 'raw-secret' }, context_line: 'private source text',
        pre_context: ['private source text'], post_context: ['private source text'],
      }, { filename: 'https://private.test/api/user@example.com', lineno: 1 }] } }] },
    });
    expect(event.contexts).toEqual(context.contexts);
    expect(event.exception.values[0].stacktrace.frames).toEqual([{
      filename: '/assets/Dashboard-AbCd1234.js', function: 'renderMap', lineno: 11, colno: 80764,
    }]);
    expect(JSON.stringify(event)).not.toMatch(/raw-secret|private|user@example/);
  });

  it('retains the syntax character and WebKit frames, stripping URL secrets', async () => {
    const error = new SyntaxError("Unexpected token '{'");
    error.stack = 'parse@capacitor://localhost/assets/maplibre-AbCd1234.js?token=secret:5:42\n'
      + '@capacitor://localhost/assets/Dashboard-AbCd1234.js:2:8';
    await captureSentryException(error);
    const [captured] = sentryMocks.captureException.mock.calls[0];
    expect(captured.name).toBe('SyntaxError');
    expect(captured.stack).toBe("SyntaxError: Unexpected token '{'\n"
      + '    at parse (/assets/maplibre-AbCd1234.js:5:42)\n'
      + '    at /assets/Dashboard-AbCd1234.js:2:8');
    expect(error.stack).toContain('token=secret');
  });

  it('does not invent reporting frames or claim an unusable component stack is available', async () => {
    await captureSentryException(new SyntaxError("Unexpected token '<'"), 'private component stack');
    const [captured, context] = sentryMocks.captureException.mock.calls[0];
    expect(captured.stack).toBe("SyntaxError: Unexpected token '<'");
    expect(context).toEqual({ tags: undefined, contexts: undefined });
  });

  it.each([
    ['https://www.speleodb.org', 'captured'],
    ['capacitor://localhost', 'captured'],
    ['https://www.speleodb.org', 'automatic'],
    ['capacitor://localhost', 'automatic'],
  ])(
    'keeps original frames through the real Capacitor SDK pipeline from %s (%s)', async (origin, report) => {
      const { capacitorRewriteFramesIntegration } = await vi.importActual<typeof import('@sentry/capacitor')>(
        '@sentry/capacitor',
      );
      initSentry();
      await vi.waitFor(() => expect(sentryMocks.nativeInit).toHaveBeenCalledOnce());
      const options = sentryMocks.nativeInit.mock.calls[0][0];
      const send = vi.fn<Transport['send']>(async () => ({}));
      const client = new BrowserClient({
        dsn: 'https://public@example.invalid/1',
        stackParser: defaultStackParser,
        integrations: [capacitorRewriteFramesIntegration()],
        beforeSend: options.beforeSend,
        transport: () => ({ send, flush: async () => true }),
      });
      client.init();
      try {
        const error = new SyntaxError("Unexpected token '{'");
        error.stack = `SyntaxError: Unexpected token '{'\n`
          + `    at renderMap (${origin}/assets/Dashboard-AbCd1234.js:11:80764)`;
        if (report === 'captured') {
          await captureSentryException(error);
          client.captureException(sentryMocks.captureException.mock.calls[0][0]);
        } else {
          // Automatic SDK errors reach the same pipeline without our Error copy.
          client.captureException(error);
        }
        await client.flush();

        expect(send).toHaveBeenCalledOnce();
        const envelope = send.mock.calls[0][0];
        expect(envelope[1][0][1]).toMatchObject({
          exception: { values: [{ stacktrace: { frames: [{
            filename: '/assets/Dashboard-AbCd1234.js',
            function: 'renderMap', lineno: 11, colno: 80764,
          }] } }] },
        });
      } finally {
        await client.close();
      }
    },
  );

  it('bounds stack frames and drops non-code stack text and invalid locations', async () => {
    const error = new Error('failure');
    error.stack = 'Error: arbitrary private text\n'
      + '    at private user@example.com\n'
      + '    at eval (eval at foo (https://x.test/assets/index-AbCd1234.js:1:2), <anonymous>:1:1)\n'
      + '    at foo (file:///Users/private/project.ts:1:2)\n'
      + '    at foo (https://x.test/assets/index-AbCd1234.js:0:2)\n'
      + Array.from({ length: 40 }, (_, i) => `    at f${i} (https://x.test/assets/index-AbCd1234.js:1:2)`).join('\n');
    await captureSentryException(error);
    const [captured] = sentryMocks.captureException.mock.calls[0];
    expect(captured.stack.split('\n')).toHaveLength(25);
    expect(captured.stack).toContain('at f23');
    expect(captured.stack).not.toMatch(/f24|private|eval|report/);
  });

  it.each([
    ['Mozilla/5.0 (Linux; Android 11; PrivateDevice) AppleWebKit/537.36 Chrome/83.0.4103.106 Mobile Safari/537.36', 'Chromium', '83.0.4103.106'],
    ['Mozilla/5.0 (PrivateDevice) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'WebKit', '605.1.15'],
  ])('records only the engine version for %s', async (agent, name, version) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
    initSentry();
    await vi.waitFor(() => expect(sentryMocks.nativeInit).toHaveBeenCalledOnce());
    const event = sentryMocks.nativeInit.mock.calls[0][0].beforeSend({ contexts: { private: {} } });
    expect(event.contexts).toEqual({ browser: { name, version } });
  });
});
