import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import * as Speech from "expo-speech";
import { getBaseUrl } from "@workspace/api-client-react";
import type { Story } from "@workspace/api-client-react";
import React, {
  createContext,
  useCallback,
  useContext,
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

async function configureAudioSession() {
  try {
    // Field names confirmed from expo-audio v1.1.1 Audio.types.d.ts:
    // playsInSilentMode (not playsInSilentModeIOS)
    // shouldPlayInBackground (not staysActiveInBackground)
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
  const [isBarVisible, setIsBarVisible] = useState(false);

  const [isAudioMode, setIsAudioMode] = useState(false);
  const isAudioModeRef = useRef(false);

  // Speech-mode state
  const [speechPositionMs, setSpeechPositionMs] = useState(0);
  const [speechDurationMs, setSpeechDurationMs] = useState(0);
  const [speechPlaying, setSpeechPlaying] = useState(false);

  const speechTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechOffsetRef = useRef<{ startTime: number; offsetMs: number } | null>(null);
  // Refs for pause/resume support
  const speechTextRef = useRef<string>("");
  const speechDurationMsRef = useRef<number>(0);
  const speechPausedAtMsRef = useRef<number>(0);
  // Closure-safe refs for toggle
  const speechPlayingRef = useRef(false);
  const speechPositionMsRef = useRef(0);
  // Generation counter: incremented each time we stop speech so that any
  // pending onDone/onStopped callback from a previous Speech.speak() knows
  // it's stale and should not reset position or cancel the new timer.
  const speechGenRef = useRef(0);

  // updateInterval goes in useAudioPlayer options — useAudioPlayerStatus takes only one arg
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const audioStatus = useAudioPlayerStatus(player);

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

  const positionMs = isAudioMode
    ? Math.round((audioStatus.currentTime ?? 0) * 1000)
    : speechPositionMs;
  const durationMs = isAudioMode
    ? Math.round((audioStatus.duration ?? 0) * 1000)
    : speechDurationMs;
  const isPlaying = isAudioMode ? (audioStatus.playing ?? false) : speechPlaying;

  const _stopSpeech = useCallback(() => {
    // Bump generation BEFORE Speech.stop() so any pending onDone/onStopped
    // callback from the outgoing speech sees a stale gen and bails out.
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

      // Capture the generation for this session. Any onEnd that fires with a
      // different (newer) gen is stale — from a Speech.stop() we already issued —
      // and must not reset position or kill our new timer.
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
        // Ignore callbacks belonging to a previous (stopped) speech session.
        if (speechGenRef.current !== myGen) return;
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

  const playStory = useCallback(
    async (newStory: Story) => {
      _stopSpeech();
      player.pause();
      _setAudioMode(false);

      setStory(newStory);
      setIsBarVisible(true);
      _setSpeechPositionMs(0);
      setSpeechDurationMs(0);
      _setSpeechPlaying(false);
      speechPausedAtMsRef.current = 0;

      const audioUrl = (newStory as any).audioUrl as string | undefined;

      if (audioUrl) {
        const fullUrl = `${getBaseUrl() ?? ""}${audioUrl}`;
        await configureAudioSession();
        _setAudioMode(true);
        player.replace({ uri: fullUrl });
        player.play();
        // Register this player as the lock-screen "Now Playing" source so the
        // system media controls (lock screen, Control Center) reflect CRRNT audio.
        try {
          player.setActiveForLockScreen(true, {
            title: newStory.title,
            artist: "CRRNT",
            artworkUrl: (newStory as any).mediaUrl ?? undefined,
          });
        } catch {}
      } else {
        // expo-speech fallback — configure audio session first so iOS plays
        // even when the device ringer switch is on silent
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

  const togglePlayPause = useCallback(async () => {
    if (isAudioModeRef.current) {
      if (player.playing) {
        player.pause();
      } else {
        player.play();
      }
      return;
    }

    // Speech mode — proper pause/resume
    if (speechPlayingRef.current) {
      // PAUSE: record current position then stop
      speechPausedAtMsRef.current = speechPositionMsRef.current;
      _stopSpeech();
    } else {
      // RESUME: re-speak from where we left off
      const text = speechTextRef.current;
      if (!text) return;
      await configureAudioSession();
      _startSpeechFrom(text, speechPausedAtMsRef.current, speechDurationMsRef.current);
    }
  }, [player, _stopSpeech, _startSpeechFrom]);

  const seekTo = useCallback(
    async (ms: number) => {
      if (isAudioModeRef.current) {
        // seekTo is async — must await before play() so iOS doesn't fire play at old position
        await player.seekTo(ms / 1000);
        player.play();
        return;
      }
      // Speech seek — restart from the new position
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
    setStory(null);
    _setSpeechPositionMs(0);
    setSpeechDurationMs(0);
    _setSpeechPlaying(false);
    speechPausedAtMsRef.current = 0;
    speechTextRef.current = "";
  }, [player, _stopSpeech]);

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
