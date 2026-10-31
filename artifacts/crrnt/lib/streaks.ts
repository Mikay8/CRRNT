/**
 * On-device reading streaks (Mikayla's design, 2026-10-31).
 *
 * The streak is a personalized-Feed feature: a day counts when the
 * user finishes that day's Feed — every story in the top-five list
 * from lib/personalization's personalizedFeed — by reading or playing
 * it. Opening a story, or playing it from anywhere (card, queue,
 * lock screen), marks it finished for the day; finished stories hide
 * from the Feed view, so the shrinking list is the progress bar.
 *
 * Everything lives on the phone (AsyncStorage, same external-store
 * pattern as lib/personalization): guests have no accounts, and the
 * server never sees streak state. The day boundary is the phone's
 * local calendar day, matching the "ends tonight at midnight" copy.
 * Users without personalization (quiz skipped / turned off) get no
 * streak at all — there is no Feed for them to finish.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";

export interface StreakState {
  version: 1;
  /** Local date (YYYY-MM-DD) -> story ids finished that day. */
  finishedByDate: Record<string, string[]>;
  /** Local dates whose Feed was fully finished. */
  completedDates: string[];
  /** Longest run of consecutive completed days, ever. */
  best: number;
  /** Total playback seconds (audio + speech), all time. */
  listenedSec: number;
}

const STREAKS_KEY = "@crrnt/streaks/v1";
const KEEP_FINISHED_DAYS = 62;
const KEEP_COMPLETED_DAYS = 400;

// ── Local-date helpers ────────────────────────────────────────────────────────

export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDateStr(new Date(y, m - 1, d + n));
}

export function todayStr(): string {
  return localDateStr(new Date());
}

// ── Store (same shape as lib/personalization) ─────────────────────────────────

let cache: StreakState | null = null;
let loadedFlag = false;
let loadingPromise: Promise<void> | null = null;
let unflushedListenSec = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): StreakState | null {
  return cache;
}

function emptyState(): StreakState {
  return { version: 1, finishedByDate: {}, completedDates: [], best: 0, listenedSec: 0 };
}

function ensureStreaksLoaded(): void {
  if (loadedFlag || loadingPromise) return;
  loadingPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STREAKS_KEY);
      const parsed = raw ? (JSON.parse(raw) as StreakState) : null;
      cache =
        parsed && parsed.version === 1 && parsed.finishedByDate && parsed.completedDates
          ? parsed
          : emptyState();
    } catch {
      cache = emptyState();
    }
    loadedFlag = true;
    loadingPromise = null;
    emit();
  })();
}

export async function loadStreaks(): Promise<StreakState> {
  ensureStreaksLoaded();
  if (loadingPromise) await loadingPromise;
  return cache ?? emptyState();
}

async function persist(): Promise<void> {
  if (!cache) return;
  unflushedListenSec = 0;
  try {
    await AsyncStorage.setItem(STREAKS_KEY, JSON.stringify(cache));
  } catch {
    // Non-critical: the in-memory state still applies for this session.
  }
}

export function useStreaks(): { state: StreakState | null; loaded: boolean } {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => null);
  useEffect(() => {
    ensureStreaksLoaded();
  }, []);
  return { state, loaded: loadedFlag };
}

// ── Derived values ────────────────────────────────────────────────────────────

export function finishedOn(state: StreakState | null, dateStr: string): string[] {
  return state?.finishedByDate[dateStr] ?? [];
}

export function isDayComplete(state: StreakState | null, dateStr: string): boolean {
  return !!state && state.completedDates.includes(dateStr);
}

/** Consecutive completed days ending at dateStr (0 when dateStr isn't complete). */
export function runEndingAt(state: StreakState, dateStr: string): number {
  const done = new Set(state.completedDates);
  let n = 0;
  let d = dateStr;
  while (done.has(d)) {
    n += 1;
    d = addDays(d, -1);
  }
  return n;
}

/**
 * The live streak: the run ending today, or the run ending yesterday
 * (today is still in play). Anything older has already lapsed to 0.
 */
export function currentStreak(state: StreakState | null): number {
  if (!state || state.completedDates.length === 0) return 0;
  const today = todayStr();
  if (isDayComplete(state, today)) return runEndingAt(state, today);
  const yesterday = addDays(today, -1);
  if (isDayComplete(state, yesterday)) return runEndingAt(state, yesterday);
  return 0;
}

export interface MonthStats {
  storiesThisMonth: number;
  daysActiveThisMonth: number;
}

export function monthStats(state: StreakState | null): MonthStats {
  if (!state) return { storiesThisMonth: 0, daysActiveThisMonth: 0 };
  const prefix = todayStr().slice(0, 7); // YYYY-MM
  let stories = 0;
  let days = 0;
  for (const [date, ids] of Object.entries(state.finishedByDate)) {
    if (!date.startsWith(prefix)) continue;
    stories += ids.length;
    if (ids.length > 0) days += 1;
  }
  return { storiesThisMonth: stories, daysActiveThisMonth: days };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

function prune(state: StreakState): void {
  const cutoff = addDays(todayStr(), -KEEP_FINISHED_DAYS);
  for (const date of Object.keys(state.finishedByDate)) {
    if (date < cutoff) delete state.finishedByDate[date];
  }
  if (state.completedDates.length > KEEP_COMPLETED_DAYS) {
    state.completedDates = state.completedDates.slice(-KEEP_COMPLETED_DAYS);
  }
}

/** Mark a story finished for today (it was opened or played). Idempotent. */
export function markStoryFinished(storyId: string): void {
  ensureStreaksLoaded();
  if (!cache) cache = emptyState();
  const today = todayStr();
  const list = cache.finishedByDate[today] ?? [];
  if (list.includes(storyId)) return;
  cache.finishedByDate[today] = [...list, storyId];
  prune(cache);
  emit();
  void persist();
}

/**
 * Latch today's completion when every story in today's Feed list has
 * been finished. Called whenever the feed data, the prefs, or the
 * finished set changes (feed screen, story screen, You tab). Safe to
 * call repeatedly; only the first qualifying call changes anything.
 * Completing the day also cancels tonight's streak reminder.
 */
export function recordFeedCompletion(feedStoryIds: string[]): void {
  ensureStreaksLoaded();
  if (!cache) cache = emptyState();
  const today = todayStr();
  if (feedStoryIds.length === 0) return;
  if (cache.completedDates.includes(today)) return;
  const finished = new Set(cache.finishedByDate[today] ?? []);
  if (!feedStoryIds.every((id) => finished.has(id))) return;
  cache.completedDates = [...cache.completedDates, today].sort();
  cache.best = Math.max(cache.best, runEndingAt(cache, today));
  prune(cache);
  emit();
  void persist();
  void import("./streak-reminder")
    .then((m) => m.syncStreakReminder())
    .catch(() => undefined);
}

/** Accumulate playback time. Persists at most every ~15 seconds. */
export function addListenedSeconds(n: number): void {
  ensureStreaksLoaded();
  if (!cache) cache = emptyState();
  cache.listenedSec += n;
  unflushedListenSec += n;
  if (unflushedListenSec >= 15) {
    emit();
    void persist();
  }
}
