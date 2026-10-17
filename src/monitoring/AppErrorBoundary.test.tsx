import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SplashScreen } from '@capacitor/splash-screen';
import { AppErrorBoundary } from './AppErrorBoundary';
import { captureSentryException } from './sentry';

vi.mock('./sentry', () => ({ captureSentryException: vi.fn() }));
vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: { hide: vi.fn().mockResolvedValue(undefined) },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('reports the original render exception and logs only safe bundled code locations', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const error = new SyntaxError("Unexpected token '{'");
  error.stack = "SyntaxError: Unexpected token '{'\n"
    + '    at Dashboard (https://www.speleodb.org/assets/Dashboard-AbCd1234.js:11:42)\n'
    + '    at fetch (https://private.test/api/user@example.com?token=private-token:1:2)';
  function BrokenDashboard(): never { throw error; }

  render(<AppErrorBoundary><BrokenDashboard /></AppErrorBoundary>);

  expect(screen.getByTestId('app-error-boundary')).toHaveTextContent('Something went wrong.');
  expect(SplashScreen.hide).toHaveBeenCalledOnce();
  expect(captureSentryException).toHaveBeenCalledWith(error, expect.stringContaining('BrokenDashboard'));
  const diagnostic = log.mock.calls.find(([message]) => message === '[AppErrorBoundary] Uncaught render error:');
  expect(diagnostic?.[1]).toMatchObject({
    name: 'SyntaxError', message: "Unexpected token '{'",
    stack: '    at Dashboard (/assets/Dashboard-AbCd1234.js:11:42)',
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(/private|user@example/);
});

it('keeps the recovery screen and reporting when native splash dismissal rejects', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(SplashScreen.hide).mockRejectedValueOnce(new Error('private-native-details'));
  const error = new TypeError('The superclass is not a constructor.');
  function BrokenStartup(): never { throw error; }

  render(<AppErrorBoundary><BrokenStartup /></AppErrorBoundary>);

  await waitFor(() => expect(warn).toHaveBeenCalledWith(
    '[splash] Failed to reveal the application error screen.',
  ));
  expect(screen.getByTestId('app-error-boundary')).toHaveTextContent('Something went wrong.');
  expect(captureSentryException).toHaveBeenCalledWith(error, expect.stringContaining('AppErrorBoundary'));
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private-native-details');
});

it.each([null, undefined])('retains recovery when a child throws %s', (thrown) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  function BrokenDashboard(): never { throw thrown; }

  render(<AppErrorBoundary><BrokenDashboard /></AppErrorBoundary>);

  expect(screen.getByTestId('app-error-boundary')).toHaveTextContent('Something went wrong.');
  expect(captureSentryException).toHaveBeenCalledWith(thrown, expect.stringContaining('BrokenDashboard'));
  expect(log).toHaveBeenCalledWith('[AppErrorBoundary] Uncaught render error:', {
    thrown, stack: undefined, componentStack: undefined,
  });
});
