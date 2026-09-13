/** Shared test setup: DOM matchers, a clean store, and a real localStorage. */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Node 22+ ships its own partial `localStorage` that shadows jsdom's and lacks
 * `clear()`. Several tests assert that we do NOT write to localStorage
 * (banner dismissal is session-only by design), so a complete, inspectable
 * implementation matters. Install one unconditionally.
 */
function createStorage() {
  let store = new Map();
  return {
    get length() {
      return store.size;
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(String(k)),
    clear: () => store.clear(),
  };
}

Object.defineProperty(window, 'localStorage', {
  value: createStorage(),
  configurable: true,
  writable: true,
});
Object.defineProperty(window, 'sessionStorage', {
  value: createStorage(),
  configurable: true,
  writable: true,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});
