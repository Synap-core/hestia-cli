/**
 * Module-level vault session cache — 30-min TTL, survives React remounts.
 * useSyncExternalStore makes it reactive across components.
 */

import { useSyncExternalStore } from "react";

const SESSION_TTL_MS = 30 * 60 * 1000;
let _key: CryptoKey | null = null;
let _expiry = 0;
const _listeners = new Set<() => void>();

function notify() { _listeners.forEach((fn) => fn()); }

export function getSessionKey(): CryptoKey | null {
  if (_key && Date.now() > _expiry) { _key = null; notify(); }
  return _key;
}

export function setSessionKey(key: CryptoKey): void {
  _key = key;
  _expiry = Date.now() + SESSION_TTL_MS;
  notify();
}

export function clearSessionKey(): void {
  _key = null;
  notify();
}

export function useVaultSessionUnlocked(): boolean {
  return useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    () => getSessionKey() !== null,
    () => false,
  );
}
