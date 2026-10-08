import { describe, expect, it, vi } from 'vitest';

describe('Bun JSDOM window compatibility', () => {
  it('does not expose a server Worker as an unsupported browser Worker', () => {
    const domWindow = (globalThis as unknown as { jsdom: { window: Window & { Worker?: typeof Worker } } }).jsdom.window;
    expect(domWindow.Worker).toBeUndefined();
    expect(typeof Worker).toBe('undefined');
  });

  it('preserves real window event delivery and listener removal', () => {
    // Vitest rewrites window and document.defaultView to its worker global.
    const domWindow = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
    const listener = vi.fn((event: Event) => ({ target: event.target, currentTarget: event.currentTarget }));
    window.addEventListener('runtime-probe', listener);
    window.dispatchEvent(new Event('runtime-probe'));
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.results[0].value.target).toBe(domWindow);
    expect(listener.mock.results[0].value.currentTarget).toBe(domWindow);
    window.removeEventListener('runtime-probe', listener);
    window.dispatchEvent(new Event('runtime-probe'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('preserves event delivery inside an iframe window', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const parentListener = vi.fn();
    window.addEventListener('runtime-probe', parentListener);
    try {
      const frame = iframe.contentWindow!;
      const event = frame.document.createEvent('Event');
      event.initEvent('runtime-probe', false, false);
      const listener = vi.fn((event: Event) => ({ target: event.target, currentTarget: event.currentTarget }));
      frame.addEventListener('runtime-probe', listener);
      frame.dispatchEvent(event);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.results[0].value.target).toBe(frame);
      expect(listener.mock.results[0].value.currentTarget).toBe(frame);
      frame.removeEventListener('runtime-probe', listener);
      frame.dispatchEvent(event);
      expect(listener).toHaveBeenCalledOnce();
      expect(parentListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('runtime-probe', parentListener);
      iframe.remove();
    }
  });

  it('keeps WebIDL brand checks for forged event targets', () => {
    for (const forged of [{}, Object.create(window)]) {
      expect(() => EventTarget.prototype.addEventListener.call(forged, 'runtime-probe', () => {}))
        .toThrow(/not a valid instance of EventTarget/);
    }
  });
});
