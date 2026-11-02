"use client";

// Things that must stay on THIS device: the monthly cycle and the athlete's meals. They live in localStorage, never in
// the database, so they are never synced, never sent to the server, and never part of a backup file — which is what
// the person was promised (see src/lib/cycleStore.ts). The price is the plain one: they go when the app's data on this
// device is cleared or the app is uninstalled, and a second device has none of them.
//
// A change made anywhere in the app tells every screen that reads the same key (useDeviceJson), so a switch flipped in
// Settings shows at once in the menu.
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

const CHANGED_EVENT = "parva:device-store-changed";

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseRaw<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readDeviceJson<T>(key: string, fallback: T): T {
  return parseRaw(readRaw(key), fallback);
}

export function writeDeviceJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (a private window): the screen keeps what it has until it is left.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function removeDeviceKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to remove from
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener);
  // Another tab of the same browser wrote it.
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGED_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * The value kept under the key, and a way to change it. Until the page is on the client (and when nothing is stored)
 * it is the fallback, so the server render and the first client render agree. The fallback must not change between renders.
 */
export function useDeviceJson<T>(key: string, fallback: T): readonly [T, (next: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null
  );
  const fallbackRef = useRef(fallback);
  const value = useMemo(() => parseRaw(raw, fallbackRef.current), [raw]);
  const set = useCallback((next: T) => writeDeviceJson(key, next), [key]);
  return [value, set] as const;
}
