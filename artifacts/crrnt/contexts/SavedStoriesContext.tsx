/**
 * SavedStoriesContext — saves/unsaves stories via the backend API.
 *
 * Falls back to local state when the user is not authenticated or
 * when API calls fail, so the UI never freezes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Story } from "@workspace/api-client-react";
import { useAuth } from "./AuthContext";

interface SavedContextValue {
  saved: Story[];
  savedIds: Set<string>;
  isSaved: (id: string) => boolean;
  toggleSaved: (story: Story) => Promise<void>;
  remove: (id: string) => Promise<void>;
  hydrated: boolean;
  refresh: () => Promise<void>;
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
      setHydrated(true);
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
    async (story: Story) => {
      if (!authHeaders) return;
      const alreadySaved = savedIds.has(story.id);
      if (alreadySaved) {
        setSaved((prev) => prev.filter((s) => s.id !== story.id));
        await fetch(`${getApiBase()}/api/stories/${story.id}/save`, {
          method: "DELETE",
          headers: authHeaders,
        }).catch(() => undefined);
      } else {
        setSaved((prev) => [story, ...prev]);
        await fetch(`${getApiBase()}/api/stories/${story.id}/save`, {
          method: "POST",
          headers: authHeaders,
        }).catch(() => undefined);
      }
    },
    [authHeaders, savedIds]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!authHeaders) return;
      setSaved((prev) => prev.filter((s) => s.id !== id));
      await fetch(`${getApiBase()}/api/stories/${id}/save`, {
        method: "DELETE",
        headers: authHeaders,
      }).catch(() => undefined);
    },
    [authHeaders]
  );

  const value = useMemo<SavedContextValue>(
    () => ({ saved, savedIds, isSaved, toggleSaved, remove, hydrated, refresh }),
    [saved, savedIds, isSaved, toggleSaved, remove, hydrated, refresh]
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
