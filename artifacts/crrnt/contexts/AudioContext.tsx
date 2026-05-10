import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import * as Speech from "expo-speech";
import { getBaseUrl, getAuthToken } from "@workspace/api-client-react";
import type { Story } from "@workspace/api-client-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { updateNowPlayingInfo, registerRemoteControls } from "@/utils/nowPlaying";

interface AudioContextType {
  story: Story | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  isBarVisible: boolean;
  queue: Story[];
  playStory: (story: Story) => Promise<void>;
  playNext: () => Promise<void>;
  playFromQueue: (index: number) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (ms: number) => Promise<void>;
  dismiss: () => Promise<void>;
  addToQueue: (story: Story) => void;
  addToQueueTop: (story: Story) => void;
  removeFromQueue: (index: number) => void;
  shuffleQueue: () => void;
}

const AudioContext = createContext<AudioContextType | null>(null);

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

async function configureAudioSession() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });
  } catch {
    // Non-critical — continue without it
  }
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [story, setStory] = useState<Story | null>(null);
  const storyRef = useRef<Story | null>(null);
  const [isBarVisible, setIsBarVisible] = useState(false);

  const [isAudioMode, setIsAudioMode] = useState(false);
  const isAudioModeRef = useRef(false);

  // Queue state
  const [queue, setQueue] = useState<Story[]>([]);
  const queueRef = useRef<Story[]>([]);

  // Speech-mode state
  const [speechPositionMs, setSpeechPositionMs] = useState(0);
  const [speechDurationMs, setSpeechDurationMs] = useState(0);
  const [speechPlaying, setSpeechPlaying] = useState(false);

  const blobUrlRef = useRef<string | null>(null);
  const speechTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechOffsetRef = useRef<{ startTime: number; offsetMs: number } | null>(null);
  const speechTextRef = useRef<string>("");
  const speechDurationMsRef = useRef<number>(0);
  const speechPausedAtMsRef = useRef<number>(0);
  const speechPlayingRef = useRef(false);
  const speechPositionMsRef = useRef(0);
  const speechGenRef = useRef(0);

  // Ref for calling playNext from speech/audio end callbacks (avoids circular dep issues)
  const playNextRef = useRef<() => Promise<void>>(async () => {});

  const player = useAudioPlayer(null, { updateInterval: 200 });
  const audioStatus = useAudioPlayerStatus(player);

  // expo-audio v1.1.1 iOS bug (GitHub #37653): periodic time observer stops firing after seek/pause.
  // Hybrid fix: duration from audioStatus (load event, not affected), position/playing polled directly.
  const [audioPositionMs, setAudioPositionMs] = useState(0);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [audioIsPlaying, setAudioIsPlaying] = useState(false);

  const audioDurationMsRef = useRef(0);
  // Track end detection refs for auto-advance
  const wasPlayingRef = useRef(false);
  const audioEndFiredRef = useRef(false);

  useEffect(() => {
    const d = audioStatus.duration;
    if (typeof d === "number" && isFinite(d) && d > 0) {
      const ms = Math.round(d * 1000);
      audioDurationMsRef.current = ms;
      setAudioDurationMs(ms);
    }
  }, [audioStatus.duration]);

  // Poll currentTime and playing — bypasses stale observer. Also detects track end for auto-advance.
  useEffect(() => {
    const timer = setInterval(() => {
      const t = player.currentTime;
      if (typeof t === "number" && isFinite(t)) {
        setAudioPositionMs(Math.round(t * 1000));
      }
      const isNowPlaying = player.playing ?? false;
      setAudioIsPlaying(isNowPlaying);

      // Detect natural track end: was playing → stopped near end → fire once
      if (
        wasPlayingRef.current &&
        !isNowPlaying &&
        !audioEndFiredRef.current &&
        isAudioModeRef.current
      ) {
        const dur = audioDurationMsRef.current;
        if (dur > 0 && typeof t === "number" && isFinite(t) && dur - t * 1000 < 1500) {
          audioEndFiredRef.current = true;
          if (queueRef.current.length > 0) {
            playNextRef.current().catch(() => {});
          }
        }
      }
      if (isNowPlaying) audioEndFiredRef.current = false;
      wasPlayingRef.current = isNowPlaying;
    }, 200);
    return () => clearInterval(timer);
  }, [player]);

  useEffect(() => {
    const cleanup = registerRemoteControls({
      onPlay: () => player.play(),
      onPause: () => player.pause(),
      onSeek: (ms) => player.seekTo(ms / 1000),
    });
    return cleanup;
  }, [player]);

  useEffect(() => {
    if (!isAudioMode || !storyRef.current) return;
    const s = storyRef.current;
    updateNowPlayingInfo({
      title: s.title,
      artist: "CRRNT",
      artworkUri: (s as any).media_url ?? undefined,
      positionMs: audioPositionMs,
      durationMs: audioDurationMs,
      isPlaying: audioIsPlaying,
    });
  }, [audioPositionMs, audioDurationMs, audioIsPlaying, isAudioMode]);

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

  const positionMs = isAudioMode ? audioPositionMs : speechPositionMs;
  const durationMs = isAudioMode ? audioDurationMs : speechDurationMs;
  const isPlaying = isAudioMode ? audioIsPlaying : speechPlaying;

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

        // Natural end — tear down cleanly then auto-advance queue if needed.
        _setSpeechPlaying(false);
        if (speechTimerRef.current) {
          clearInterval(speechTimerRef.current);
          speechTimerRef.current = null;
        }
        speechOffsetRef.current = null;
        speechPausedAtMsRef.current = 0;
        _setSpeechPositionMs(0);

        if (queueRef.current.length > 0) {
          setTimeout(() => playNextRef.current().catch(() => {}), 500);
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

  const playStory = useCallback(
    async (newStory: Story) => {
      // Reset auto-advance detection for new track
      wasPlayingRef.current = false;
      audioEndFiredRef.current = false;

      _stopSpeech();
      player.pause();
      _setAudioMode(false);

      _setStory(newStory);
      setIsBarVisible(true);
      _setSpeechPositionMs(0);
      setSpeechDurationMs(0);
      _setSpeechPlaying(false);
      speechPausedAtMsRef.current = 0;
      setAudioDurationMs(0);
      audioDurationMsRef.current = 0;
      setAudioPositionMs(0);

      const audioUrl = newStory.tts_url;
      let audioStarted = false;

      if (audioUrl) {
        const fullUrl = `${getBaseUrl() ?? ""}${audioUrl}`;
        const token = await getAuthToken();
        await configureAudioSession();

        if (typeof document !== "undefined" && token) {
          // Web: HTML5 audio can't send auth headers — fetch blob with auth first
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          try {
            const res = await fetch(fullUrl, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const blob = await res.blob();
              const blobUrl = URL.createObjectURL(blob);
              blobUrlRef.current = blobUrl;
              // Pre-load duration via HTML5 Audio — expo-audio web reports it late
              const probeEl = document.createElement("audio");
              const probeDur = await new Promise<number>((resolve) => {
                probeEl.onloadedmetadata = () => resolve((probeEl as any).duration as number);
                probeEl.onerror = () => resolve(0);
                probeEl.src = blobUrl;
              });
              if (probeDur > 0 && isFinite(probeDur)) {
                const ms = Math.round(probeDur * 1000);
                audioDurationMsRef.current = ms;
                setAudioDurationMs(ms);
              }
              player.replace({ uri: blobUrl });
              audioStarted = true;
            }
          } catch {
            // fetch failed — fall through to speech synthesis
          }
        } else {
          player.replace({
            uri: fullUrl,
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          });
          audioStarted = true;
        }
      }

      if (audioStarted) {
        _setAudioMode(true);
        player.play();
        try {
          player.setActiveForLockScreen(true, {
            title: newStory.title,
            artist: "CRRNT",
            artworkUrl: (newStory as any).media_url ?? undefined,
          });
        } catch {}
        updateNowPlayingInfo({
          title: newStory.title,
          artist: "CRRNT",
          artworkUri: (newStory as any).media_url ?? undefined,
          positionMs: 0,
          durationMs: 0,
          isPlaying: true,
        });
      } else {
        // No audio URL or audio fetch failed — fall back to speech synthesis
        await configureAudioSession();
        _setAudioMode(false);

        const text = buildSpeechText(newStory);
        speechTextRef.current = text;

        const wordCount = text.split(/\s+/).length;
        const estimatedMs = Math.max(Math.round((wordCount / 2.3) * 1000), 5000);
        setSpeechDurationMs(estimatedMs);
        speechDurationMsRef.current = estimatedMs;

        _startSpeechFrom(text, 0, estimatedMs);
      }
    },
    [player, _stopSpeech, _startSpeechFrom],
  );

  const addToQueue = useCallback((s: Story) => {
    _setQueue([...queueRef.current, s]);
  }, []);

  const addToQueueTop = useCallback((s: Story) => {
    _setQueue([s, ...queueRef.current]);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    const q = [...queueRef.current];
    q.splice(index, 1);
    _setQueue(q);
  }, []);

  const playNext = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    const [next, ...rest] = queueRef.current;
    _setQueue(rest);
    await playStory(next);
  }, [playStory]);

  const playFromQueue = useCallback(async (index: number) => {
    const q = queueRef.current;
    if (index < 0 || index >= q.length) return;
    const selected = q[index];
    _setQueue(q.slice(index + 1));
    await playStory(selected);
  }, [playStory]);

  const shuffleQueue = useCallback(() => {
    const q = [...queueRef.current];
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    _setQueue(q);
  }, []);

  // Keep playNextRef current so speech/audio end callbacks can call it without stale closure issues
  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const togglePlayPause = useCallback(async () => {
    if (isAudioModeRef.current) {
      if (player.playing) {
        player.pause();
      } else {
        player.play();
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
  }, [player, _stopSpeech, _startSpeechFrom]);

  const seekTo = useCallback(
    async (ms: number) => {
      if (isAudioModeRef.current) {
        await player.seekTo(ms / 1000);
        player.play();
        return;
      }
      const text = speechTextRef.current;
      if (!text) return;
      _stopSpeech();
      speechPausedAtMsRef.current = ms;
      await configureAudioSession();
      _startSpeechFrom(text, ms, speechDurationMsRef.current);
    },
    [player, _stopSpeech, _startSpeechFrom],
  );

  const dismiss = useCallback(async () => {
    _stopSpeech();
    player.pause();
    try { player.clearLockScreenControls(); } catch {}
    _setAudioMode(false);
    setIsBarVisible(false);
    _setStory(null);
    _setSpeechPositionMs(0);
    setSpeechDurationMs(0);
    _setSpeechPlaying(false);
    speechPausedAtMsRef.current = 0;
    speechTextRef.current = "";
    _setQueue([]);
  }, [player, _stopSpeech]);

  return (
    <AudioContext.Provider
      value={{
        story,
        isPlaying,
        positionMs,
        durationMs,
        isBarVisible,
        queue,
        playStory,
        playNext,
        playFromQueue,
        togglePlayPause,
        seekTo,
        dismiss,
        addToQueue,
        addToQueueTop,
        removeFromQueue,
        shuffleQueue,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio(): AudioContextType {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error("useAudio must be used inside AudioProvider");
  return ctx;
}
