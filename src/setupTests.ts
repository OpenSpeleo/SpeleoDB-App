import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach } from 'vitest';
import {
  assertConsoleGuardState,
  installConsoleGuards,
  resetConsoleGuardState,
} from './test/consoleGuard';

// Vitest reuses a worker across serialized test files. fake-indexeddb's auto
// entry point exports a module singleton, so without a fresh factory one file's
// databases and open connections can leak into the next file. Give every test
// file an isolated IndexedDB catalog while preserving persistence within that
// file's tests.
Object.defineProperty(globalThis, 'indexedDB', {
  value: new IDBFactory(),
  configurable: true,
  writable: true,
});

// @stencil/core (used by @ionic/core) probes adoptedStyleSheets at import time
// and during component lifecycle. jsdom does not implement it, so we shim it on
// both Document and ShadowRoot prototypes.
for (const Ctor of [typeof Document !== 'undefined' ? Document : undefined, typeof ShadowRoot !== 'undefined' ? ShadowRoot : undefined]) {
  if (Ctor && !('adoptedStyleSheets' in Ctor.prototype)) {
    Object.defineProperty(Ctor.prototype, 'adoptedStyleSheets', {
      get(this: { _adoptedStyleSheets?: CSSStyleSheet[] }) { return this._adoptedStyleSheets ?? []; },
      set(this: { _adoptedStyleSheets?: CSSStyleSheet[] }, v: CSSStyleSheet[]) { this._adoptedStyleSheets = v; },
      configurable: true,
    });
  }
}

// Mock matchmedia
window.matchMedia = window.matchMedia || function() {
  return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
  };
};

// Install a deterministic in-memory localStorage implementation for tests.
// Node 25 exposes a host getter that can emit process warnings before jsdom has
// a usable backing store, so do not probe the host implementation first.
const storage: Record<string, string> = {};
const localStorageStub = {
  getItem(key: string) {
    return storage[key] ?? null;
  },
  setItem(key: string, value: string) {
    storage[key] = value;
  },
  removeItem(key: string) {
    delete storage[key];
  },
  clear() {
    for (const key of Object.keys(storage)) delete storage[key];
  },
  get length() {
    return Object.keys(storage).length;
  },
  key() {
    return null;
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageStub,
  configurable: true,
  writable: true,
});

installConsoleGuards();
resetConsoleGuardState();

afterEach(() => {
  assertConsoleGuardState();
});
