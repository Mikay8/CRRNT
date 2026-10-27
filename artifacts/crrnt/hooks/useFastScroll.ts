import { useSyncExternalStore } from "react";

/**
 * Tracks whether a story list is being flung. While it is, StoryImage holds
 * off on remote images (some feed images are several MB, and decoding them
 * mid-fling is what drops frames) and shows the category art instead.
 */

const FAST_PX_PER_MS = 1.2;
const SETTLE_MS = 140;

let fast = false;
let lastY = 0;
let lastT = 0;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (fast === next) return;
  fast = next;
  listeners.forEach((l) => l());
}

/** Call from a list's onScroll with its content offset. */
export function reportScroll(y: number) {
  const now = Date.now();
  const dt = now - lastT;
  const speed = dt > 0 && dt < 200 ? Math.abs(y - lastY) / dt : 0;
  lastY = y;
  lastT = now;
  if (speed > FAST_PX_PER_MS) set(true);
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => set(false), SETTLE_MS);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useIsFastScrolling(): boolean {
  return useSyncExternalStore(subscribe, () => fast, () => false);
}
