import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';
import { captureSentryException } from './sentry';

vi.mock('./sentry', () => ({ captureSentryException: vi.fn() }));

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
  expect(captureSentryException).toHaveBeenCalledWith(error, expect.stringContaining('BrokenDashboard'));
  const diagnostic = log.mock.calls.find(([message]) => message === '[AppErrorBoundary] Uncaught render error:');
  expect(diagnostic?.[1]).toMatchObject({
    name: 'SyntaxError', message: "Unexpected token '{'",
    stack: '    at Dashboard (/assets/Dashboard-AbCd1234.js:11:42)',
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(/private|user@example/);
});
