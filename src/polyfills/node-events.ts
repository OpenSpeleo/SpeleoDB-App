/**
 * Browser-safe `events` polyfill, aliased in `vite.config.ts` because
 * `gpx-builder` -> `xmlbuilder2` statically imports Node's `events`
 * (`XMLBuilderCBImpl extends EventEmitter`). The synchronous `buildGPX` path the
 * app uses never instantiates that streaming builder, so at runtime only the
 * class declaration is evaluated -- but we implement the full common Node
 * `EventEmitter` surface anyway so a future `xmlbuilder2` (or any other consumer
 * pulled into the bundle) can't break GPX generation on-device.
 *
 * NOTE: this is exercised by `gpx.test.ts` (vitest applies the same Vite alias),
 * so the methods used by the GPX path are covered. Full on-device verification
 * inside the Capacitor WebView is still a manual smoke step (see docs/gps-tracks.md).
 */

type Listener = (...args: unknown[]) => void;

export class EventEmitter {
  static defaultMaxListeners = 10;

  private listenerMap = new Map<string | symbol, Listener[]>();
  private maxListeners = EventEmitter.defaultMaxListeners;

  private add(eventName: string | symbol, listener: Listener, prepend: boolean): this {
    const listeners = this.listenerMap.get(eventName) ?? [];
    if (prepend) listeners.unshift(listener);
    else listeners.push(listener);
    this.listenerMap.set(eventName, listeners);
    return this;
  }

  on(eventName: string | symbol, listener: Listener): this {
    return this.add(eventName, listener, false);
  }

  addListener(eventName: string | symbol, listener: Listener): this {
    return this.on(eventName, listener);
  }

  prependListener(eventName: string | symbol, listener: Listener): this {
    return this.add(eventName, listener, true);
  }

  once(eventName: string | symbol, listener: Listener): this {
    return this.add(eventName, this.wrapOnce(eventName, listener), false);
  }

  prependOnceListener(eventName: string | symbol, listener: Listener): this {
    return this.add(eventName, this.wrapOnce(eventName, listener), true);
  }

  private wrapOnce(eventName: string | symbol, listener: Listener): Listener {
    const onceListener: Listener = (...args) => {
      this.off(eventName, onceListener);
      listener(...args);
    };
    return onceListener;
  }

  off(eventName: string | symbol, listener: Listener): this {
    const listeners = this.listenerMap.get(eventName);
    if (!listeners) return this;
    const next = listeners.filter((candidate) => candidate !== listener);
    if (next.length > 0) this.listenerMap.set(eventName, next);
    else this.listenerMap.delete(eventName);
    return this;
  }

  removeListener(eventName: string | symbol, listener: Listener): this {
    return this.off(eventName, listener);
  }

  removeAllListeners(eventName?: string | symbol): this {
    if (eventName === undefined) this.listenerMap.clear();
    else this.listenerMap.delete(eventName);
    return this;
  }

  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    const listeners = this.listenerMap.get(eventName);
    if (!listeners || listeners.length === 0) return false;
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return true;
  }

  listeners(eventName: string | symbol): Listener[] {
    return [...(this.listenerMap.get(eventName) ?? [])];
  }

  rawListeners(eventName: string | symbol): Listener[] {
    return this.listeners(eventName);
  }

  listenerCount(eventName: string | symbol): number {
    return this.listenerMap.get(eventName)?.length ?? 0;
  }

  eventNames(): (string | symbol)[] {
    return [...this.listenerMap.keys()];
  }

  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this.maxListeners;
  }
}

// Node compatibility: `require('events').EventEmitter` resolves to the class.
(EventEmitter as unknown as { EventEmitter: typeof EventEmitter }).EventEmitter = EventEmitter;

export default {
  EventEmitter,
};
