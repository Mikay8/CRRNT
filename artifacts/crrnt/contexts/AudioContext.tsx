import {
  useAudioPlaylist,
  useAudioPlaylistStatus,
  setAudioModeAsync,
} from "expo-audio";
import * as Speech from "expo-speech";
import { getBaseUrl } from "@workspace/api-client-react";
import type { Story } from "@workspace/api-client-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { addListenedSeconds, markStoryFinished } from "@/lib/streaks";

interface AudioContextType {
  story: Story | null;
  isPlaying: boolean;
  isAudioLoading: boolean;
  isBarVisible: boolean;
  queue: Story[];
  canPrevious: boolean;
  playStory: (story: Story) => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  playFromQueue: (index: number) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (ms: number) => Promise<void>;
  dismiss: () => Promise<void>;
  addToQueue: (story: Story) => void;
  addToQueueTop: (story: Story) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  shuffleQueue: () => void;
}

interface AudioProgress {
  positionMs: number;
  durationMs: number;
}

const AudioContext = createContext<AudioContextType | null>(null);
// Playback position ticks every 200ms, so it lives in its own context: only
// the player UI re-renders with it, not every story card using useAudio().
const AudioProgressContext = createContext<AudioProgress>({ positionMs: 0, durationMs: 0 });

function buildSpeechText(story: Story): string {
  const parts: string[] = [];
  parts.push(story.title + ".");
  if (story.life_impact)
    parts.push("Here's how it affects you. " + story.life_impact);
  if (story.wallet_impact)
    parts.push("Wallet impact. " + story.one_liner + ". " + story.wallet_impact);
  if (story.people_say)
    parts.push("What people are saying. " + story.people_say);
  return parts.join(" ");
}

/**
 * A story is audio-capable when it carries a playable file URL. Stories
 * without one (Fish synthesis failed at ingestion) fall back to device
 * speech synthesis and can never sit inside the native playlist.
 */
function isAudioStory(story: Story): boolean {
  return !!story.tts_url;
}

/**
 * Lock-screen metadata for a story. The artwork URL is only included when
 * it is a non-empty absolute http(s) URL: expo-audio's native layer converts
 * it to a URL, and an empty string (which 7 of the live feed's 26 stories
 * carry for media_url) fails that conversion and throws — which used to
 * abort the whole setActiveForLockScreen call, leaving audio playing with
 * Control Center showing "Not Playing". Null/undefined is fine; "" is not.
 * Stories with no usable media_url fall back to the hosted app icon, so the
 * card always shows art: expo-audio's native loader fetches over the
 * network only, so a bundled asset can't be used here (and the site's
 * favicon is ICO, which iOS can't decode). Swap for a crrnt-news.com-hosted
 * icon later if preferred.
 */
const FALLBACK_ARTWORK_URL =
  "https://raw.githubusercontent.com/Mikay8/CRRNT/main/artifacts/crrnt/assets/images/icon.png";

function buildLockScreenMetadata(story: Story) {
  const rawArtwork = (story as any).media_url as string | null | undefined;
  const artworkUrl =
    rawArtwork && /^https?:\/\//i.test(rawArtwork) ? rawArtwork : FALLBACK_ARTWORK_URL;
  return {
    title: story.title,
    artist: "CRRNT",
    artworkUrl,
  };
}

async function configureAudioSession() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      // Required for lock-screen association: without doNotMix the session
      // stays mixWithOthers and iOS may not attach Control Center / lock
      // screen controls to this player (audio plays, Center shows "Not
      // Playing"). See Expo docs note on setActiveForLockScreen.
      interruptionMode: "doNotMix",
    });
  } catch {
    // Non-critical — continue without it
  }
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const [story, setStory] = useState<Story | null>(null);
  const storyRef = useRef<Story | null>(null);
  const [isBarVisible, setIsBarVisible] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [canPrevious, setCanPrevious] = useState(false);

  const [isAudioMode, setIsAudioMode] = useState(false);
  const isAudioModeRef = useRef(false);

  // Play-order model: one list — [...played, current, ...upcoming] — with
  // an index pointing at the current story. The exposed queue is always
  // list[index+1..], and Previous is simply index-1, so stories are never
  // destroyed by advancing the way the old pop-the-queue model did.
  const listRef = useRef<Story[]>([]);
  const indexRef = useRef(-1);
  const [queue, setQueue] = useState<Story[]>([]);
  const queueRef = useRef<Story[]>([]);

  // Speech-mode state
  const [speechPositionMs, setSpeechPositionMs] = useState(0);
  const [speechDurationMs, setSpeechDurationMs] = useState(0);
  const [speechPlaying, setSpeechPlaying] = useState(false);

  const speechTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechOffsetRef = useRef<{ startTime: number; offsetMs: number } | null>(null);
  const speechTextRef = useRef<string>("");
  const speechDurationMsRef = useRef<number>(0);
  const speechPausedAtMsRef = useRef<number>(0);
  const speechPlayingRef = useRef(false);
  const speechPositionMsRef = useRef(0);
  const speechGenRef = useRef(0);

  // The native playlist (expo-audio AudioPlaylist) holds the audio-capable
  // stories of the current contiguous run — from just after the previous
  // speech story (or the list start) up to just before the next speech
  // story (or the list end). Track-to-track advance, background playback,
  // and the Control Center / lock-screen next & previous commands all run
  // natively on it; JS only mirrors the state for the UI.
  const playlist = useAudioPlaylist({ updateInterval: 200, loop: "none" });
  const playlistStatus = useAudioPlaylistStatus(playlist);
  const winFromRef = useRef(0); // list index the loaded window starts at
  const winBoundaryRef = useRef(0); // list index the loaded window ends before
  const winLoadedRef = useRef(false); // whether a window was ever loaded

  const [audioPositionMs, setAudioPositionMs] = useState(0);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [audioIsPlaying, setAudioIsPlaying] = useState(false);

  const audioDurationMsRef = useRef(0);
  // End-of-window detection: shared by the status event and the poll so a
  // finished last loaded track advances exactly once. The poll only trusts
  // a playing -> stopped transition, so a user pausing near the end of the
  // last track is never mistaken for a finish.
  const wasPlayingRef = useRef(false);
  const audioEndFiredRef = useRef(false);

  // Ref for advancing from speech/end callbacks without stale closures.
  const advanceRef = useRef<() => void>(() => {});

  const _setStory = (s: Story | null) => {
    storyRef.current = s;
    setStory(s);
  };

  const _setAudioMode = (val: boolean) => {
    isAudioModeRef.current = val;
    setIsAudioMode(val);
  };

  const _setSpeechPlaying = (val: boolean) => {
    speechPlayingRef.current = val;
    setSpeechPlaying(val);
  };

  const _setSpeechPositionMs = (val: number) => {
    speechPositionMsRef.current = val;
    setSpeechPositionMs(val);
  };

  const _setQueue = (q: Story[]) => {
    queueRef.current = q;
    setQueue(q);
  };

  /** Re-derive the exposed story / queue / canPrevious from list + index. */
  const _syncDerived = () => {
    const list = listRef.current;
    const idx = indexRef.current;
    _setStory(idx >= 0 && idx < list.length ? list[idx] : null);
    _setQueue(idx >= 0 ? list.slice(idx + 1) : [...list]);
    setCanPrevious(idx > 0);
  };

  /** Playlist index of a list index, or -1 when it isn't loaded. */
  const _audioOrdinal = (listIdx: number): number => {
    const list = listRef.current;
    if (listIdx < winFromRef.current || listIdx >= winBoundaryRef.current) return -1;
    let ord = 0;
    for (let i = winFromRef.current; i < listIdx; i++) {
      if (isAudioStory(list[i])) ord++;
    }
    return isAudioStory(list[listIdx]) ? ord : -1;
  };

  /** List index for a playlist index within the loaded window. */
  const _listIndexForOrdinal = (ord: number): number => {
    const list = listRef.current;
    let seen = -1;
    for (let i = winFromRef.current; i < winBoundaryRef.current && i < list.length; i++) {
      if (isAudioStory(list[i])) {
        seen++;
        if (seen === ord) return i;
      }
    }
    return -1;
  };

  /** Source URI for an audio story, mirroring the old native player path:
   * a presigned S3 URL is self-authenticating; only our own API's relative
   * fallback path needs the base URL and a ?token=. */
  const _sourceFor = (s: Story): { uri: string } => {
    const path = s.tts_url ?? "";
    if (/^https?:\/\//i.test(path)) return { uri: path };
    const baseUrl = getBaseUrl() ?? "";
    const alreadyHasToken = path.includes("token=");
    const uri =
      !alreadyHasToken && accessToken
        ? `${baseUrl}${path}?token=${encodeURIComponent(accessToken)}`
        : `${baseUrl}${path}`;
    return { uri };
  };

  const _activateLockScreen = (s: Story) => {
    try {
      playlist.setActiveForLockScreen(true, buildLockScreenMetadata(s), {
        showNextTrack: true,
        showPreviousTrack: true,
        showSeekForward: false,
        showSeekBackward: false,
      });
    } catch (e) {
      // Never swallow this silently: a failed activation is exactly
      // "audio plays but Control Center shows Not Playing".
      console.warn("[Audio] setActiveForLockScreen failed", e);
    }
  };

  /**
   * (Re)load the playlist window around a list index: the contiguous run
   * of audio-capable stories containing it, bounded by speech stories.
   * Returns the playlist ordinal of the given index.
   */
  const _loadWindow = (aroundIdx: number): number => {
    const list = listRef.current;
    let from = aroundIdx;
    while (from > 0 && isAudioStory(list[from - 1])) from--;
    let boundary = aroundIdx + 1;
    while (boundary < list.length && isAudioStory(list[boundary])) boundary++;
    try {
      playlist.clear();
      for (let i = from; i < boundary; i++) {
        if (isAudioStory(list[i])) playlist.add(_sourceFor(list[i]));
      }
    } catch (e) {
      console.warn("[Audio] playlist window load failed", e);
    }
    winFromRef.current = from;
    winBoundaryRef.current = boundary;
    winLoadedRef.current = true;
    return _audioOrdinal(aroundIdx);
  };

  /**
   * After a queue mutation, re-sync the loaded sources AFTER the current
   * story to match the list up to the next speech story. Sources at and
   * before the current story are never touched, so playback of the
   * current track is undisturbed.
   */
  const _resyncTail = () => {
    const list = listRef.current;
    const idx = indexRef.current;
    if (idx < 0) return;
    let boundary = idx + 1;
    while (boundary < list.length && isAudioStory(list[boundary])) boundary++;
    // No window loaded yet (e.g. queue built before anything played, or
    // an all-speech session): the next audio start loads from the list.
    if (!winLoadedRef.current) return;
    // Loaded sources belonging to list positions up to the current story.
    let keepCount = 0;
    const upto = Math.min(idx, winBoundaryRef.current - 1);
    for (let i = winFromRef.current; i <= upto && i < list.length; i++) {
      if (isAudioStory(list[i])) keepCount++;
    }
    try {
      while (playlist.trackCount > keepCount) playlist.remove(keepCount);
      for (let i = idx + 1; i < boundary; i++) {
        if (isAudioStory(list[i])) playlist.add(_sourceFor(list[i]));
      }
    } catch (e) {
      console.warn("[Audio] playlist tail resync failed", e);
    }
    winBoundaryRef.current = boundary;
  };

  const positionMs = isAudioMode ? audioPositionMs : speechPositionMs;
  const durationMs = isAudioMode ? audioDurationMs : speechDurationMs;
  const isPlaying = isAudioMode ? audioIsPlaying : speechPlaying;

  // Streaks (lib/streaks): a story that is actually playing counts as
  // finished for today — this covers card taps, queue auto-advance,
  // and lock-screen skips, which all land on `story` + isPlaying —
  // and playback time feeds the You tab's "Listened" stat.
  useEffect(() => {
    if (story && isPlaying) markStoryFinished(story.id);
  }, [story, isPlaying]);

  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => addListenedSeconds(1), 1000);
    return () => clearInterval(t);
  }, [isPlaying]);

  const _stopSpeech = useCallback(() => {
    speechGenRef.current += 1;
    if (speechTimerRef.current) {
      clearInterval(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    speechOffsetRef.current = null;
    Speech.stop();
    _setSpeechPlaying(false);
  }, []);

  const _startSpeechFrom = useCallback(
    (text: string, fromMs: number, totalMs: number) => {
      if (speechTimerRef.current) {
        clearInterval(speechTimerRef.current);
        speechTimerRef.current = null;
      }

      const myGen = speechGenRef.current;

      speechOffsetRef.current = { startTime: Date.now(), offsetMs: fromMs };

      speechTimerRef.current = setInterval(() => {
        const offset = speechOffsetRef.current;
        if (!offset) {
          clearInterval(speechTimerRef.current!);
          speechTimerRef.current = null;
          return;
        }
        _setSpeechPositionMs(
          Math.min(Date.now() - offset.startTime + offset.offsetMs, totalMs),
        );
      }, 200);

      const onEnd = () => {
        if (speechGenRef.current !== myGen) return;

        const currentMs = speechPositionMsRef.current;
        const remaining = totalMs - currentMs;

        // Chrome's ~15s utterance limit workaround — restart from current position.
        if (remaining > 5000) {
          if (speechTimerRef.current) {
            clearInterval(speechTimerRef.current);
            speechTimerRef.current = null;
          }
          speechOffsetRef.current = { startTime: Date.now(), offsetMs: currentMs };
          speechTimerRef.current = setInterval(() => {
            const offset = speechOffsetRef.current;
            if (!offset) {
              clearInterval(speechTimerRef.current!);
              speechTimerRef.current = null;
              return;
            }
            _setSpeechPositionMs(
              Math.min(Date.now() - offset.startTime + offset.offsetMs, totalMs),
            );
          }, 200);
          Speech.speak(text, {
            language: "en-US",
            rate: 0.9,
            pitch: 1.0,
            volume: 1.0,
            onDone: onEnd,
            onError: onEnd,
            onStopped: onEnd,
          });
          return;
        }

        // Natural end — tear down cleanly then advance if a story follows.
        _setSpeechPlaying(false);
        if (speechTimerRef.current) {
          clearInterval(speechTimerRef.current);
          speechTimerRef.current = null;
        }
        speechOffsetRef.current = null;
        speechPausedAtMsRef.current = 0;
        _setSpeechPositionMs(0);

        if (indexRef.current < listRef.current.length - 1) {
          setTimeout(() => advanceRef.current(), 500);
        }
      };

      _setSpeechPlaying(true);
      Speech.speak(text, {
        language: "en-US",
        rate: 0.9,
        pitch: 1.0,
        volume: 1.0,
        onDone: onEnd,
        onError: onEnd,
        onStopped: onEnd,
      });
    },
    [],
  );

  /** Start playback of the audio story at a list index, loading or
   * extending the native window when the track isn't loaded yet. */
  const _playAudioAt = useCallback(
    (listIdx: number) => {
      let ord = _audioOrdinal(listIdx);
      if (ord < 0 || ord >= playlist.trackCount) {
        ord = _loadWindow(listIdx);
      }
      if (ord >= 0 && playlist.currentIndex !== ord) {
        try {
          playlist.skipTo(ord);
        } catch (e) {
          console.warn("[Audio] playlist skipTo failed", e);
        }
      }
      playlist.play();
      _activateLockScreen(listRef.current[listIdx]);
    },
    [playlist],
  );

  /** The one router every transition goes through: next, previous, queue
   * taps, card taps (via playStory), speech end, and window end. */
  const startAt = useCallback(
    async (listIdx: number) => {
      const list = listRef.current;
      if (listIdx < 0 || listIdx >= list.length) return;
      const target = list[listIdx];

      audioEndFiredRef.current = false;
      wasPlayingRef.current = false;
      indexRef.current = listIdx;
      _syncDerived();
      setIsAudioLoading(true);
      _stopSpeech();
      playlist.pause();
      setIsBarVisible(true);
      _setSpeechPositionMs(0);
      setSpeechDurationMs(0);
      speechPausedAtMsRef.current = 0;
      setAudioDurationMs(0);
      audioDurationMsRef.current = 0;
      setAudioPositionMs(0);

      await configureAudioSession();

      if (isAudioStory(target)) {
        _setAudioMode(true);
        _playAudioAt(listIdx);
      } else {
        // Speech detour: the playlist idles (paused, not lock-screen
        // active) while the device voice reads this story.
        playlist.pause();
        try {
          playlist.setActiveForLockScreen(false);
        } catch {
          // Non-critical
        }
        _setAudioMode(false);
        setIsAudioLoading(false);

        const text = buildSpeechText(target);
        speechTextRef.current = text;
        const wordCount = text.split(/\s+/).length;
        const estimatedMs = Math.max(Math.round((wordCount / 2.3) * 1000), 5000);
        setSpeechDurationMs(estimatedMs);
        speechDurationMsRef.current = estimatedMs;
        _startSpeechFrom(text, 0, estimatedMs);
      }
    },
    [playlist, _stopSpeech, _startSpeechFrom, _playAudioAt],
  );

  const advance = useCallback(() => {
    if (indexRef.current < listRef.current.length - 1) {
      startAt(indexRef.current + 1).catch(() => {});
    }
  }, [startAt]);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  // Native track changes (auto-advance inside the window, Control Center
  // / lock-screen next & previous, in-app skipTo) are adopted into the
  // list model so the UI and queue always mirror what is playing.
  useEffect(() => {
    const sub = playlist.addListener("trackChanged", ({ currentIndex }) => {
      const listIdx = _listIndexForOrdinal(currentIndex);
      if (listIdx < 0 || listIdx === indexRef.current) return;
      indexRef.current = listIdx;
      audioEndFiredRef.current = false;
      _syncDerived();
      setAudioPositionMs(0);
      setAudioDurationMs(0);
      audioDurationMsRef.current = 0;
      const s = listRef.current[listIdx];
      if (s) {
        try {
          playlist.updateLockScreenMetadata(buildLockScreenMetadata(s));
        } catch (e) {
          console.warn("[Audio] updateLockScreenMetadata failed", e);
        }
      }
    });
    return () => sub.remove();
  }, [playlist]);

  // Loaded duration: clear the loading state, and re-publish lock-screen
  // metadata once the item is actually loaded — if the first publish raced
  // the load, iOS can drop it, and this refreshes Control Center with the
  // real duration.
  useEffect(() => {
    const d = playlistStatus.duration;
    if (typeof d === "number" && isFinite(d) && d > 0 && isAudioModeRef.current) {
      const ms = Math.round(d * 1000);
      audioDurationMsRef.current = ms;
      setAudioDurationMs(ms);
      setIsAudioLoading(false);
      const s = storyRef.current;
      if (s) {
        try {
          playlist.updateLockScreenMetadata(buildLockScreenMetadata(s));
        } catch (e) {
          console.warn("[Audio] updateLockScreenMetadata failed", e);
        }
      }
    }
    if (playlistStatus.isLoaded) setIsAudioLoading(false);
  }, [playlistStatus.duration, playlistStatus.isLoaded, playlist]);

  // End of the loaded window: the last loaded track finished and the
  // playlist has nothing to advance into natively. If the list continues
  // (a speech story, or the next audio run), move there. The playing /
  // near-end checks keep this from firing when the playlist auto-advanced
  // into its last track (that finish belongs to the previous track).
  const _handleWindowEnd = useCallback(() => {
    if (!isAudioModeRef.current || audioEndFiredRef.current) return;
    if (playlist.playing) return;
    if (playlist.currentIndex < playlist.trackCount - 1) return;
    const dur = audioDurationMsRef.current;
    const t = playlist.currentTime;
    if (dur <= 0 || typeof t !== "number" || !isFinite(t)) return;
    if (dur - t * 1000 >= 1500) return;
    if (indexRef.current >= listRef.current.length - 1) return;
    audioEndFiredRef.current = true;
    advanceRef.current();
  }, [playlist]);

  useEffect(() => {
    if (playlistStatus.didJustFinish) _handleWindowEnd();
  }, [playlistStatus.didJustFinish, _handleWindowEnd]);

  // Poll position / playing for the UI (expo-audio's periodic observer is
  // unreliable after seek/pause, so position has always been polled), with
  // the window-end check as a backstop to the status event.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isAudioModeRef.current) return;
      const t = playlist.currentTime;
      if (typeof t === "number" && isFinite(t)) {
        setAudioPositionMs(Math.round(t * 1000));
      }
      const isNowPlaying = playlist.playing ?? false;
      setAudioIsPlaying(isNowPlaying);
      if (isNowPlaying) {
        audioEndFiredRef.current = false;
      } else if (wasPlayingRef.current) {
        _handleWindowEnd();
      }
      wasPlayingRef.current = isNowPlaying;
    }, 200);
    return () => clearInterval(timer);
  }, [playlist, _handleWindowEnd]);

  const playStory = useCallback(
    async (newStory: Story) => {
      // A fresh tap keeps the existing up-next tail (same contract as
      // before) but starts a new list anchored at the tapped story.
      const tail = listRef.current.slice(indexRef.current + 1);
      listRef.current = [newStory, ...tail];
      winLoadedRef.current = false;
      winFromRef.current = 0;
      winBoundaryRef.current = 0;
      await startAt(0);
    },
    [startAt],
  );

  const addToQueue = useCallback((s: Story) => {
    listRef.current = [...listRef.current, s];
    _syncDerived();
    _resyncTail();
  }, []);

  const addToQueueTop = useCallback((s: Story) => {
    const list = [...listRef.current];
    list.splice(indexRef.current + 1, 0, s);
    listRef.current = list;
    _syncDerived();
    _resyncTail();
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    const list = [...listRef.current];
    const listIdx = indexRef.current + 1 + index;
    if (listIdx <= indexRef.current || listIdx >= list.length) return;
    list.splice(listIdx, 1);
    listRef.current = list;
    _syncDerived();
    _resyncTail();
  }, []);

  const moveInQueue = useCallback((from: number, to: number) => {
    const list = [...listRef.current];
    const base = indexRef.current + 1;
    const fromIdx = base + from;
    const toIdx = base + to;
    if (fromIdx < base || fromIdx >= list.length || fromIdx === toIdx) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(Math.max(base, Math.min(toIdx, list.length)), 0, moved);
    listRef.current = list;
    _syncDerived();
    _resyncTail();
  }, []);

  const clearQueue = useCallback(() => {
    listRef.current = listRef.current.slice(0, indexRef.current + 1);
    _syncDerived();
    _resyncTail();
  }, []);

  const playNext = useCallback(async () => {
    if (indexRef.current >= listRef.current.length - 1) return;
    await startAt(indexRef.current + 1);
  }, [startAt]);

  const playPrevious = useCallback(async () => {
    if (indexRef.current <= 0) return;
    await startAt(indexRef.current - 1);
  }, [startAt]);

  const playFromQueue = useCallback(
    async (index: number) => {
      const listIdx = indexRef.current + 1 + index;
      if (index < 0 || listIdx >= listRef.current.length) return;
      await startAt(listIdx);
    },
    [startAt],
  );

  const shuffleQueue = useCallback(() => {
    const list = [...listRef.current];
    const base = indexRef.current + 1;
    for (let i = list.length - 1; i > base; i--) {
      const j = base + Math.floor(Math.random() * (i - base + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    listRef.current = list;
    _syncDerived();
    _resyncTail();
  }, []);

  const togglePlayPause = useCallback(async () => {
    if (isAudioModeRef.current) {
      if (playlist.playing) {
        playlist.pause();
      } else {
        playlist.play();
      }
      return;
    }

    if (speechPlayingRef.current) {
      speechPausedAtMsRef.current = speechPositionMsRef.current;
      _stopSpeech();
    } else {
      const text = speechTextRef.current;
      if (!text) return;
      await configureAudioSession();
      _startSpeechFrom(text, speechPausedAtMsRef.current, speechDurationMsRef.current);
    }
  }, [playlist, _stopSpeech, _startSpeechFrom]);

  const seekTo = useCallback(
    async (ms: number) => {
      if (isAudioModeRef.current) {
        await playlist.seekTo(ms / 1000);
        playlist.play();
        return;
      }
      const text = speechTextRef.current;
      if (!text) return;
      _stopSpeech();
      speechPausedAtMsRef.current = ms;
      await configureAudioSession();
      _startSpeechFrom(text, ms, speechDurationMsRef.current);
    },
    [playlist, _stopSpeech, _startSpeechFrom],
  );

  const dismiss = useCallback(async () => {
    setIsAudioLoading(false);
    _stopSpeech();
    playlist.pause();
    try {
      playlist.clearLockScreenControls();
    } catch (e) {
      console.warn("[Audio] clearLockScreenControls failed", e);
    }
    try {
      playlist.clear();
    } catch {
      // Non-critical
    }
    winLoadedRef.current = false;
    winFromRef.current = 0;
    winBoundaryRef.current = 0;
    listRef.current = [];
    indexRef.current = -1;
    _setAudioMode(false);
    setIsBarVisible(false);
    _setStory(null);
    _setQueue([]);
    setCanPrevious(false);
    _setSpeechPositionMs(0);
    setSpeechDurationMs(0);
    _setSpeechPlaying(false);
    speechPausedAtMsRef.current = 0;
    speechTextRef.current = "";
    setAudioPositionMs(0);
    setAudioDurationMs(0);
    audioDurationMsRef.current = 0;
  }, [playlist, _stopSpeech]);

  const value = useMemo(
    () => ({
      story,
      isPlaying,
      isAudioLoading,
      isBarVisible,
      queue,
      canPrevious,
      playStory,
      playNext,
      playPrevious,
      playFromQueue,
      togglePlayPause,
      seekTo,
      dismiss,
      addToQueue,
      addToQueueTop,
      removeFromQueue,
      moveInQueue,
      clearQueue,
      shuffleQueue,
    }),
    [
      story,
      isPlaying,
      isAudioLoading,
      isBarVisible,
      queue,
      canPrevious,
      playStory,
      playNext,
      playPrevious,
      playFromQueue,
      togglePlayPause,
      seekTo,
      dismiss,
      addToQueue,
      addToQueueTop,
      removeFromQueue,
      moveInQueue,
      clearQueue,
      shuffleQueue,
    ],
  );
  const progress = useMemo(() => ({ positionMs, durationMs }), [positionMs, durationMs]);

  return (
    <AudioContext.Provider value={value}>
      <AudioProgressContext.Provider value={progress}>{children}</AudioProgressContext.Provider>
    </AudioContext.Provider>
  );
}

export function useAudio(): AudioContextType {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error("useAudio must be used inside AudioProvider");
  return ctx;
}

/** Playback position and duration — subscribe only where the time is shown. */
export function useAudioProgress(): AudioProgress {
  return useContext(AudioProgressContext);
}
