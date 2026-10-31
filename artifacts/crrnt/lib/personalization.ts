/**
 * On-device feed personalization.
 *
 * The quiz answers live ONLY in AsyncStorage on this phone — they are
 * never sent to the server (Mikayla's call, 2026-10-30: the Morning
 * Edition push stays the same global pick for everyone rather than
 * storing tags server-side). The Feed view shows the day's five
 * best-matching stories, scored locally against these tags: ingestion
 * gives each story a `vibe` (informed / entertained / both) and its
 * category; the user's tags are their picked categories, vibe, and
 * free-text never-miss follow terms.
 *
 * State is a tiny external store so the first-run gate, the quiz
 * screen, Settings, and the feed all read the same snapshot.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";
import type { Story } from "@workspace/api-client-react";
import type { Category } from "@/constants/categories";

export type VibeTag = "informed" | "entertained";

export interface PersonalizationPrefs {
  version: 1;
  /** True when the user skipped the quiz or turned personalization off. */
  skipped: boolean;
  interests: Category[];
  vibe: VibeTag[];
  /** Free-text never-miss terms: names, teams, topics, places. A story
   * mentioning one always leads the feed. */
  follows: string[];
  updatedAt: string;
}

/** Suggested follow terms per picked category ("Based on your picks"). */
export const FOLLOW_SUGGESTIONS: Record<Category, string[]> = {
  celebrity: ["Taylor Swift", "Beyoncé", "the royals"],
  entertainment: ["Marvel", "Netflix", "Taylor Swift"],
  tech: ["Apple", "AI", "Tesla", "NASA"],
  government: ["Ukraine", "Middle East", "the Fed", "Congress"],
  sports: ["World Cup", "the Olympics", "NFL", "the Lakers"],
  business: ["the Fed", "rent", "Tesla", "Apple"],
  science: ["NASA", "climate", "AI", "space"],
  world: ["Ukraine", "Middle East", "climate", "Europe"],
  health: ["flu season", "mental health", "vaccines", "cancer"],
};

/** Up to `cap` unique suggestions across the picked categories. */
export function suggestionsFor(interests: Category[], cap = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cat of interests) {
    for (const term of FOLLOW_SUGGESTIONS[cat] ?? []) {
      const k = term.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(term);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

const PREFS_KEY = "@crrnt/personalization/v1";

let cache: PersonalizationPrefs | null = null;
let loadedFlag = false;
let loadingPromise: Promise<void> | null = null;
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

function getSnapshot(): PersonalizationPrefs | null {
  return cache;
}

export function ensurePersonalizationLoaded(): void {
  if (loadedFlag || loadingPromise) return;
  loadingPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      cache = raw ? (JSON.parse(raw) as PersonalizationPrefs) : null;
    } catch {
      cache = null;
    }
    loadedFlag = true;
    loadingPromise = null;
    emit();
  })();
}

/** Resolves with the stored prefs, or null when the quiz was never answered. */
export async function loadPersonalization(): Promise<PersonalizationPrefs | null> {
  ensurePersonalizationLoaded();
  if (loadingPromise) await loadingPromise;
  return cache;
}

export async function savePersonalization(prefs: PersonalizationPrefs): Promise<void> {
  cache = prefs;
  loadedFlag = true;
  emit();
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Non-critical: the in-memory prefs still apply for this session.
  }
}

export function usePersonalization(): {
  prefs: PersonalizationPrefs | null;
  loaded: boolean;
} {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => null);
  useEffect(() => {
    ensurePersonalizationLoaded();
  }, []);
  return { prefs, loaded: loadedFlag };
}

export function isPersonalizationActive(
  prefs: PersonalizationPrefs | null,
): prefs is PersonalizationPrefs {
  return !!prefs && !prefs.skipped;
}

/**
 * Match score for one story against the user's tags. A follow-term
 * mention dominates — those stories "always lead your feed" — then
 * category interests, then vibe as a nudge. A story whose vibe is
 * "both" matches either vibe tag; a story with no vibe (older than the
 * tagging rollout) matches neither.
 */
export function scoreStory(
  story: Pick<Story, "category" | "vibe" | "title" | "display_title" | "summary" | "one_liner">,
  prefs: PersonalizationPrefs,
): number {
  let score = 0;
  if (prefs.follows.length > 0) {
    const haystack = [story.display_title, story.title, story.summary, story.one_liner]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    for (const term of prefs.follows) {
      const t = term.trim().toLowerCase();
      if (t.length >= 2 && haystack.includes(t)) score += 5;
    }
  }
  const category = (story.category ?? "") as Category;
  if (prefs.interests.includes(category)) score += 2;
  const vibe = story.vibe ?? null;
  if (vibe === "both") {
    if (prefs.vibe.length > 0) score += 1;
  } else if (vibe === "informed" || vibe === "entertained") {
    if (prefs.vibe.includes(vibe)) score += 1;
  }
  return score;
}

/** How many stories the personalized Feed view shows per day. */
export const FEED_STORY_LIMIT = 5;

/**
 * The personalized Feed list: the day's best-matching stories, best
 * first, capped at FEED_STORY_LIMIT. Any match counts — a follow
 * mention, a picked category, or a vibe match — and low scores still
 * rank: on a thin day the best available stories fill the five slots
 * (published order breaks ties), so the Feed is never empty while the
 * day has stories. Input must be sorted newest-first; the feed screen
 * and the story screen's Up Next chain both build the list through
 * here so they always agree.
 */
export function personalizedFeed(
  stories: Story[],
  prefs: PersonalizationPrefs,
): Story[] {
  return stories
    .map((s, i) => ({ s, i, score: scoreStory(s, prefs) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, FEED_STORY_LIMIT)
    .map((x) => x.s);
}
