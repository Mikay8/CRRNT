import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Story } from "@workspace/api-client-react";

const STORAGE_KEY = "@crrnt/saved-stories/v1";

interface SavedContextValue {
  saved: Story[];
  savedIds: Set<string>;
  isSaved: (id: string) => boolean;
  toggleSaved: (story: Story) => Promise<void>;
  remove: (id: string) => Promise<void>;
  hydrated: boolean;
}

const SavedStoriesContext = createContext<SavedContextValue | null>(null);

export function SavedStoriesProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<Story[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Story[];
          if (Array.isArray(parsed)) setSaved(parsed);
        }
      } catch {
        // Corrupt storage — start fresh.
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next: Story[]) => {
    setSaved(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage failure is non-fatal — we still have it in memory.
    }
  }, []);

  const savedIds = useMemo(
    () => new Set(saved.map((s) => s.articleId)),
    [saved]
  );

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const toggleSaved = useCallback(
    async (story: Story) => {
      if (savedIds.has(story.articleId)) {
        await persist(saved.filter((s) => s.articleId !== story.articleId));
      } else {
        await persist([story, ...saved]);
      }
    },
    [saved, savedIds, persist]
  );

  const remove = useCallback(
    async (id: string) => {
      await persist(saved.filter((s) => s.articleId !== id));
    },
    [saved, persist]
  );

  const value = useMemo<SavedContextValue>(
    () => ({ saved, savedIds, isSaved, toggleSaved, remove, hydrated }),
    [saved, savedIds, isSaved, toggleSaved, remove, hydrated]
  );

  return (
    <SavedStoriesContext.Provider value={value}>{children}</SavedStoriesContext.Provider>
  );
}

export function useSavedStories(): SavedContextValue {
  const ctx = useContext(SavedStoriesContext);
  if (!ctx) {
    throw new Error("useSavedStories must be used inside <SavedStoriesProvider>");
  }
  return ctx;
}
