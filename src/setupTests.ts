// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/extend-expect';
import 'fake-indexeddb/auto';

// Mock matchmedia
window.matchMedia = window.matchMedia || function() {
  return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
  };
};

// Ensure localStorage is available and has all methods (jsdom/vitest)
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
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.removeItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageStub, configurable: true, writable: true });
}
