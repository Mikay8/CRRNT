/**
 * SavedStoriesContext — saves/unsaves stories via the backend API.
 *
 * Guests (no access token) save to device storage instead, so bookmarks
 * work while accounts are switched off. API failures keep local state, so
 * the UI never freezes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Story } from "@workspace/api-client-react";
import { useAuth } from "./AuthContext";
import { capture } from "@/lib/analytics";
import { DEFAULT_SAVE_LIMIT } from "@/constants/features";

const GUEST_SAVED_KEY = "@crrnt/saved/guest/v1";
const SAVE_LIMIT_KEY = "@crrnt/save-limit/v1";

/** "limit" = the save was refused because the user is at the save
 * limit; callers surface the limit message their own way. */
export type ToggleSavedResult = "saved" | "unsaved" | "limit";

function persistGuestSaved(stories: Story[]) {
  AsyncStorage.setItem(GUEST_SAVED_KEY, JSON.stringify(stories)).catch(() => {});
}

interface SavedContextValue {
  saved: Story[];
  savedIds: Set<string>;
  isSaved: (id: string) => boolean;
  toggleSaved: (story: Story) => Promise<ToggleSavedResult>;
  remove: (id: string) => Promise<void>;
  hydrated: boolean;
  refresh: () => Promise<void>;
  /** The admin's save limit (Feed & Save Limits), fetched from
   * /api/config; DEFAULT_SAVE_LIMIT until it loads. */
  saveLimit: number;
}

const SavedStoriesContext = createContext<SavedContextValue | null>(null);

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  const base = process.env.EXPO_PUBLIC_API_BASE;
  if (base) return base;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function SavedStoriesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { accessToken } = useAuth();
  const [saved, setSaved] = useState<Story[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveLimit, setSaveLimit] = useState(DEFAULT_SAVE_LIMIT);
  const saveLimitRef = useRef(DEFAULT_SAVE_LIMIT);

  // The save limit is the admin's Feed & Save Limits value, served by
  // GET /api/config. Load the last known value from storage first so
  // enforcement is correct before the network answers, then refresh
  // it. One variable limit for every save — guests included, whose
  // saves never reach the server-side check (owner's call, 2026-11-07).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(SAVE_LIMIT_KEY);
        const n = cached ? parseInt(cached, 10) : NaN;
        if (!cancelled && Number.isFinite(n) && n >= 1) {
          saveLimitRef.current = n;
          setSaveLimit(n);
        }
      } catch {
        // Keep the default until the fetch below lands.
      }
      try {
        const res = await fetch(`${getApiBase()}/api/config`);
        if (res.ok) {
          const data = await res.json();
          const n = Number(data?.save_limit);
          if (!cancelled && Number.isFinite(n) && n >= 1) {
            saveLimitRef.current = n;
            setSaveLimit(n);
            AsyncStorage.setItem(SAVE_LIMIT_KEY, String(n)).catch(() => {});
          }
        }
      } catch {
        // Offline or unreachable — the cached/default limit stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const authHeaders = useMemo(
    () =>
      accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          }
        : null,
    [accessToken]
  );

  const refresh = useCallback(async () => {
    if (!authHeaders) {
      try {
        const raw = await AsyncStorage.getItem(GUEST_SAVED_KEY);
        setSaved(raw ? (JSON.parse(raw) as Story[]) : []);
      } catch {
        // Corrupt or unreadable — start empty
      } finally {
        setHydrated(true);
      }
      return;
    }
    try {
      const res = await fetch(`${getApiBase()}/api/stories/saved`, {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setSaved((data.stories as Story[]) || []);
      }
    } catch {
      // Non-fatal — keep existing state
    } finally {
      setHydrated(true);
    }
  }, [authHeaders]);

  useEffect(() => {
    refresh().catch(() => setHydrated(true));
  }, [refresh]);

  const savedIds = useMemo(() => new Set(saved.map((s) => s.id)), [saved]);

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const toggleSaved = useCallback(
    async (story: Story): Promise<ToggleSavedResult> => {
      const alreadySaved = savedIds.has(story.id);
      if (!alreadySaved && savedIds.size >= saveLimitRef.current) {
        // At the limit: refuse the save (unsaving always works, and
        // anyone already over the limit just can't add until they're
        // back under it — nothing is pruned for them).
        return "limit";
      }
      // Analytics (lib/analytics): every save/unsave funnels through here.
      capture(alreadySaved ? "story_unsaved" : "story_saved", {
        story_id: story.id,
        category: story.category,
      });
      if (!authHeaders) {
        setSaved((prev) => {
          const next = alreadySaved
            ? prev.filter((s) => s.id !== story.id)
            : [story, ...prev];
          persistGuestSaved(next);
          return next;
        });
        return alreadySaved ? "unsaved" : "saved";
      }
      if (alreadySaved) {
        setSaved((prev) => prev.filter((s) => s.id !== story.id));
        await fetch(`${getApiBase()}/api/stories/${story.id}/save`, {
          method: "DELETE",
          headers: authHeaders,
        }).catch(() => undefined);
        return "unsaved";
      }
      setSaved((prev) => [story, ...prev]);
      await fetch(`${getApiBase()}/api/stories/${story.id}/save`, {
        method: "POST",
        headers: authHeaders,
      }).catch(() => undefined);
      return "saved";
    },
    [authHeaders, savedIds]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!authHeaders) {
        setSaved((prev) => {
          const next = prev.filter((s) => s.id !== id);
          persistGuestSaved(next);
          return next;
        });
        return;
      }
      setSaved((prev) => prev.filter((s) => s.id !== id));
      await fetch(`${getApiBase()}/api/stories/${id}/save`, {
        method: "DELETE",
        headers: authHeaders,
      }).catch(() => undefined);
    },
    [authHeaders]
  );

  const value = useMemo<SavedContextValue>(
    () => ({
      saved, savedIds, isSaved, toggleSaved, remove, hydrated, refresh,
      saveLimit,
    }),
    [saved, savedIds, isSaved, toggleSaved, remove, hydrated, refresh, saveLimit]
  );

  return (
    <SavedStoriesContext.Provider value={value}>
      {children}
    </SavedStoriesContext.Provider>
  );
}

export function useSavedStories(): SavedContextValue {
  const ctx = useContext(SavedStoriesContext);
  if (!ctx) {
    throw new Error("useSavedStories must be used inside <SavedStoriesProvider>");
  }
  return ctx;
}
