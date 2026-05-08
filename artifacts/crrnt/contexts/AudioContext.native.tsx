// Native (iOS/Android) audio context — uses react-native-track-player for
// audio-file playback and expo-speech for TTS fallback stories.
// The web version (AudioContext.tsx) keeps expo-audio + expo-speech.
import TrackPlayer, {
  useProgress,
  usePlaybackState,
  State,
  Capability,
  Event,
} from "react-native-track-player";
import * as Speech from "expo-speech";
import { getBaseUrl } from "@workspace/api-client-react";
import type { Story } from "@workspace/api-client-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface AudioContextType {
  story: Story | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  isBarVisible: boolean;
  playStory: (story: Story) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (ms: number) => Promise<void>;
  dismiss: () => Promise<void>;
}

const AudioContext = createContext<AudioContextType | null>(null);

function buildSpeechText(story: Story): string {
  const parts: string[] = [];
  parts.push(story.title + ".");
  if ((story as any).lifeImpact)
    parts.push("Here's how it affects you. " + (story as any).lifeImpact);
  parts.push("Wallet impact. " + story.insight + ". " + (story as any).walletImpact);
  if ((story as any).peopleSay)
    parts.push("What people are saying. " + (story as any).peopleSay);
  return parts.join(" ");
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [story, setStory] = useState<Story | null>(null);
  const storyRef = useRef<Story | null>(null);
  const [isBarVisible, setIsBarVisible] = useState(false);

  const [isAudioMode, setIsAudioMode] = useState(false);
  const isAudioModeRef = useRef(false);

  // ─── Speech-mode state (same logic as the web AudioContext) ──────────────
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

  // ─── RNTP state ───────────────────────────────────────────────────────────
  // useProgress polls RNTP every 200 ms — position & duration are always valid
  // floats (never NaN), so no guards needed here.
  const { position, duration } = useProgress(200);
  const playbackState = usePlaybackState();

  // Keep a ref so togglePlayPause callback doesn't stale-close over the state.
  const rnIsPlayingRef = useRef(false);
  useEffect(() => {
    rnIsPlayingRef.current = playbackState.state === State.Playing;
  }, [playbackState.state]);

  // ─── Setup RNTP once on mount ─────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function setup() {
      try {
        await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
        if (!mounted) return;
        await TrackPlayer.updateOptions({
          capabilities: [Capability.Play, Capability.Pause, Capability.SeekTo],
          compactCapabilities: [Capability.Play, Capability.Pause],
          progressUpdateEventInterval: 1,
        });
      } catch {
        // setupPlayer throws if already initialized — safe to ignore.
      }
    }
    setup();
    return () => { mounted = false; };
  }, []);

  // ─── Helpers ─────────────────────────────────────────────────────────────
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

  // ─── Derived values ───────────────────────────────────────────────────────
  // RNTP values are already in seconds; convert to ms for a consistent API.
  const audioPositionMs = Math.round(position * 1000);
  const audioDurationMs = Math.round(duration * 1000);

  const positionMs = isAudioMode ? audioPositionMs : speechPositionMs;
  const durationMs = isAudioMode ? audioDurationMs : speechDurationMs;
  const isPlaying = isAudioMode
    ? playbackState.state === State.Playing
    : speechPlaying;

  // ─── Speech helpers (identical to web AudioContext) ───────────────────────
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

        // Guard against premature onDone (can happen on some devices).
        // If more than 5 s remain, restart from the current position.
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

        // Natural end.
        _setSpeechPlaying(false);
        if (speechTimerRef.current) {
          clearInterval(speechTimerRef.current);
          speechTimerRef.current = null;
        }
        speechOffsetRef.current = null;
        speechPausedAtMsRef.current = 0;
        _setSpeechPositionMs(0);
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

  // ─── Public API ───────────────────────────────────────────────────────────
  const playStory = useCallback(
    async (newStory: Story) => {
      // Stop any in-progress speech first.
      _stopSpeech();
      _setAudioMode(false);

      _setStory(newStory);
      setIsBarVisible(true);
      _setSpeechPositionMs(0);
      setSpeechDurationMs(0);
      _setSpeechPlaying(false);
      speechPausedAtMsRef.current = 0;

      const audioUrl = (newStory as any).audioUrl as string | undefined;

      if (audioUrl) {
        const fullUrl = `${getBaseUrl() ?? ""}${audioUrl}`;
        _setAudioMode(true);

        // Reset the queue and load the new track.
        // RNTP handles the audio session, lock-screen metadata, and remote
        // controls automatically — no manual setAudioModeAsync needed.
        await TrackPlayer.reset();
        await TrackPlayer.add({
          id: newStory.articleId,
          url: fullUrl,
          title: newStory.title,
          artist: "CRRNT",
          artwork: (newStory as any).mediaUrl ?? undefined,
        });
        await TrackPlayer.play();
      } else {
        // TTS fallback — RNTP queue cleared; expo-speech takes the session.
        await TrackPlayer.reset().catch(() => undefined);
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
    [_stopSpeech, _startSpeechFrom],
  );

  const togglePlayPause = useCallback(async () => {
    if (isAudioModeRef.current) {
      if (rnIsPlayingRef.current) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }
      return;
    }

    // Speech mode.
    if (speechPlayingRef.current) {
      speechPausedAtMsRef.current = speechPositionMsRef.current;
      _stopSpeech();
    } else {
      const text = speechTextRef.current;
      if (!text) return;
      _startSpeechFrom(text, speechPausedAtMsRef.current, speechDurationMsRef.current);
    }
  }, [_stopSpeech, _startSpeechFrom]);

  const seekTo = useCallback(
    async (ms: number) => {
      if (isAudioModeRef.current) {
        await TrackPlayer.seekTo(ms / 1000);
        return;
      }
      // Speech seek.
      const text = speechTextRef.current;
      if (!text) return;
      _stopSpeech();
      speechPausedAtMsRef.current = ms;
      _startSpeechFrom(text, ms, speechDurationMsRef.current);
    },
    [_stopSpeech, _startSpeechFrom],
  );

  const dismiss = useCallback(async () => {
    _stopSpeech();
    await TrackPlayer.reset().catch(() => undefined);
    _setAudioMode(false);
    setIsBarVisible(false);
    _setStory(null);
    _setSpeechPositionMs(0);
    setSpeechDurationMs(0);
    _setSpeechPlaying(false);
    speechPausedAtMsRef.current = 0;
    speechTextRef.current = "";
  }, [_stopSpeech]);

  return (
    <AudioContext.Provider
      value={{
        story,
        isPlaying,
        positionMs,
        durationMs,
        isBarVisible,
        playStory,
        togglePlayPause,
        seekTo,
        dismiss,
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
