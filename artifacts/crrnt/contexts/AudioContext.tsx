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
  const storyRef = useRef<Story | null>(null);
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

  const player = useAudioPlayer(null, { updateInterval: 200 });
  const audioStatus = useAudioPlayerStatus(player);

  // expo-audio v1.1.1 iOS bug (GitHub #37653): the periodic time observer that
  // drives useAudioPlayerStatus stops firing after seek/pause, so currentTime
  // freezes at its old value.
  //
  // Hybrid fix:
  //   • duration  → use audioStatus.duration (set via the audio-LOAD event, not
  //                 the periodic timer, so it fires correctly even in v1.1.1).
  //                 Retain the last known-good value in state so it survives
  //                 observer gaps.
  //   • currentTime / playing → poll player directly at 200 ms with isFinite
  //                 guards (NaN can appear on iOS during seek transitions).
  const [audioPositionMs, setAudioPositionMs] = useState(0);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [audioIsPlaying, setAudioIsPlaying] = useState(false);

  // Capture duration from the status subscription — it comes via a load event
  // that is NOT affected by the timer-observer bug, so it arrives reliably.
  useEffect(() => {
    const d = audioStatus.duration;
    if (typeof d === "number" && isFinite(d) && d > 0) {
      setAudioDurationMs(Math.round(d * 1000));
    }
  }, [audioStatus.duration]);

  // Poll currentTime and playing directly — bypasses the stale observer.
  // isFinite guards prevent NaN (which iOS can emit during seek transitions)
  // from leaking into position state.
  useEffect(() => {
    const timer = setInterval(() => {
      const t = player.currentTime;
      if (typeof t === "number" && isFinite(t)) {
        setAudioPositionMs(Math.round(t * 1000));
      }
      setAudioIsPlaying(player.playing ?? false);
    }, 200);
    return () => clearInterval(timer);
  }, [player]);

  // Register lock-screen remote control handlers once on mount.
  useEffect(() => {
    const cleanup = registerRemoteControls({
      onPlay: () => player.play(),
      onPause: () => player.pause(),
      onSeek: (ms) => player.seekTo(ms / 1000),
    });
    return cleanup;
  }, [player]);

  // Keep lock-screen elapsed time in sync with actual playback position.
  useEffect(() => {
    if (!isAudioMode || !storyRef.current) return;
    const s = storyRef.current;
    updateNowPlayingInfo({
      title: s.title,
      artist: "CRRNT",
      artworkUri: (s as any).mediaUrl ?? undefined,
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

  const positionMs = isAudioMode ? audioPositionMs : speechPositionMs;
  const durationMs = isAudioMode ? audioDurationMs : speechDurationMs;
  const isPlaying = isAudioMode ? audioIsPlaying : speechPlaying;

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

        const currentMs = speechPositionMsRef.current;
        const remaining = totalMs - currentMs;

        // Chrome's Web SpeechSynthesis API silently kills long utterances after
        // ~15 s (onDone fires even though playback wasn't finished). On iOS
        // AVSpeechSynthesizer doesn't have this bug, but the guard is harmless.
        // If we're still far from the end, restart from the current position
        // so playback continues uninterrupted — same gen, seamless continuation.
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

        // Natural end — tear down cleanly.
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

      _setStory(newStory);
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
        // Prime the lock screen with position=0 before the first status tick.
        updateNowPlayingInfo({
          title: newStory.title,
          artist: "CRRNT",
          artworkUri: (newStory as any).mediaUrl ?? undefined,
          positionMs: 0,
          durationMs: 0,
          isPlaying: true,
        });
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
    _setStory(null);
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
