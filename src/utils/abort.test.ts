import { describe, expect, it } from 'vitest';
import { createAbortError, isAbortError, throwIfAborted } from './abort';

describe('abort utilities', () => {
  it('recognizes local and cross-realm-shaped abort errors', () => {
    expect(isAbortError(createAbortError())).toBe(true);
    expect(isAbortError({ name: 'AbortError', message: 'foreign realm' })).toBe(true);
    expect(isAbortError(new Error('failure'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it('normalizes an abort reason into the current DOMException realm', () => {
    const controller = new AbortController();
    controller.abort({ name: 'AbortError', message: 'foreign cancellation' });

    expect(() => throwIfAborted(controller.signal)).toThrowError(
      expect.objectContaining({
        name: 'AbortError',
        message: 'foreign cancellation',
      }),
    );
    try {
      throwIfAborted(controller.signal);
    } catch (error) {
      if (typeof DOMException !== 'undefined') {
        expect(error).toBeInstanceOf(DOMException);
      }
    }
  });

  it('preserves ordinary error and string cancellation reasons', () => {
    const failure = new Error('ordinary failure');
    const errorController = new AbortController();
    errorController.abort(failure);
    expect(() => throwIfAborted(errorController.signal)).toThrow(failure);

    const stringController = new AbortController();
    stringController.abort('explicit cancellation');
    expect(() => throwIfAborted(stringController.signal)).toThrow(
      'explicit cancellation',
    );
  });
});
