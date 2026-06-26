import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './node-events';

describe('node-events EventEmitter polyfill', () => {
  it('registers and emits to listeners (on/emit)', () => {
    const ee = new EventEmitter();
    const spy = vi.fn();
    ee.on('data', spy);
    expect(ee.emit('data', 1, 2)).toBe(true);
    expect(spy).toHaveBeenCalledWith(1, 2);
  });

  it('returns false when emitting an event with no listeners', () => {
    expect(new EventEmitter().emit('nope')).toBe(false);
  });

  it('once fires a single time then auto-removes', () => {
    const ee = new EventEmitter();
    const spy = vi.fn();
    ee.once('end', spy);
    ee.emit('end');
    ee.emit('end');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ee.listenerCount('end')).toBe(0);
  });

  it('off / removeListener detach a specific listener', () => {
    const ee = new EventEmitter();
    const keep = vi.fn();
    const drop = vi.fn();
    ee.on('x', keep);
    ee.on('x', drop);
    ee.off('x', drop);
    ee.emit('x');
    expect(keep).toHaveBeenCalledTimes(1);
    expect(drop).not.toHaveBeenCalled();
  });

  it('removeAllListeners clears one or every event', () => {
    const ee = new EventEmitter();
    ee.on('a', vi.fn());
    ee.on('b', vi.fn());
    ee.removeAllListeners('a');
    expect(ee.listenerCount('a')).toBe(0);
    expect(ee.eventNames()).toEqual(['b']);
    ee.removeAllListeners();
    expect(ee.eventNames()).toEqual([]);
  });

  it('supports prepend ordering and listener introspection', () => {
    const ee = new EventEmitter();
    const order: string[] = [];
    ee.on('e', () => order.push('second'));
    ee.prependListener('e', () => order.push('first'));
    ee.emit('e');
    expect(order).toEqual(['first', 'second']);
    expect(ee.listenerCount('e')).toBe(2);
    expect(ee.listeners('e')).toHaveLength(2);
  });

  it('addListener aliases on, and max-listeners accessors round-trip', () => {
    const ee = new EventEmitter();
    const spy = vi.fn();
    ee.addListener('y', spy);
    ee.emit('y');
    expect(spy).toHaveBeenCalled();
    ee.setMaxListeners(42);
    expect(ee.getMaxListeners()).toBe(42);
  });

  it('exposes the Node-compatible static EventEmitter self-reference', () => {
    expect((EventEmitter as unknown as { EventEmitter: unknown }).EventEmitter).toBe(EventEmitter);
  });
});
