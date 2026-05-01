import { Audio } from "expo-av";
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
  if ((story as any).lifeImpact) {
    parts.push("Here's how it affects you. " + (story as any).lifeImpact);
  }
  parts.push("Wallet impact. " + story.insight + ". " + (story as any).walletImpact);
  if ((story as any).peopleSay) {
    parts.push("What people are saying. " + (story as any).peopleSay);
  }
  return parts.join(" ");
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [story, setStory] = useState<Story | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isBarVisible, setIsBarVisible] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const isSpeechRef = useRef(false);
  // Speech-only: elapsed-time simulation (expo-speech has no position API)
  const speechTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechOffsetRef = useRef<{ startTime: number; offsetMs: number } | null>(null);

  const _stopSpeechTimer = () => {
    if (speechTimerRef.current) {
      clearInterval(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    speechOffsetRef.current = null;
  };

  const _unload = useCallback(async () => {
    _stopSpeechTimer();
    isSpeechRef.current = false;
    Speech.stop();
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => undefined);
      await soundRef.current.unloadAsync().catch(() => undefined);
      soundRef.current = null;
    }
  }, []);

  const playStory = useCallback(
    async (newStory: Story) => {
      await _unload();

      setStory(newStory);
      setIsPlaying(true);
      setIsBarVisible(true);
      setPositionMs(0);
      setDurationMs(0);

      const audioUrl = (newStory as any).audioUrl as string | undefined;

      if (audioUrl) {
        const fullUrl = `${getBaseUrl() ?? ""}${audioUrl}`;
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

        const { sound } = await Audio.Sound.createAsync(
          { uri: fullUrl },
          { shouldPlay: true },
        );

        // setOnPlaybackStatusUpdate is the native engine callback — reliable on both
        // iOS/Android and web, unlike a JS setInterval polling getStatusAsync.
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          setPositionMs(status.positionMillis ?? 0);
          if (status.durationMillis) setDurationMs(status.durationMillis);
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPositionMs(0);
            soundRef.current?.unloadAsync().catch(() => undefined);
            soundRef.current = null;
          }
        });

        // Fire the callback every 200ms during playback for smooth progress
        sound.setProgressUpdateIntervalAsync(200).catch(() => undefined);
        soundRef.current = sound;
      } else {
        // expo-speech fallback: simulate progress with elapsed time
        isSpeechRef.current = true;
        const text = buildSpeechText(newStory);
        // ~2.3 words/sec at rate 0.9 (≈138 wpm)
        const estimatedMs = Math.max(Math.round((text.split(/\s+/).length / 2.3) * 1000), 5000);
        setDurationMs(estimatedMs);
        speechOffsetRef.current = { startTime: Date.now(), offsetMs: 0 };

        speechTimerRef.current = setInterval(() => {
          const offset = speechOffsetRef.current;
          if (!offset || !isSpeechRef.current) {
            _stopSpeechTimer();
            return;
          }
          const elapsed = Date.now() - offset.startTime + offset.offsetMs;
          setPositionMs(Math.min(elapsed, estimatedMs));
        }, 200);

        const onEnd = () => {
          setIsPlaying(false);
          isSpeechRef.current = false;
          _stopSpeechTimer();
        };

        Speech.speak(text, {
          language: "en-US",
          rate: 0.9,
          pitch: 1.0,
          volume: 1.0,
          onDone: onEnd,
          onError: onEnd,
          onStopped: onEnd,
        });
      }
    },
    [_unload],
  );

  const togglePlayPause = useCallback(async () => {
    if (isSpeechRef.current) {
      Speech.stop();
      setIsPlaying(false);
      isSpeechRef.current = false;
      _stopSpeechTimer();
      return;
    }

    if (!soundRef.current) return;
    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;

    if (status.isPlaying) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
    } else {
      await soundRef.current.playAsync();
      setIsPlaying(true);
    }
  }, []);

  const seekTo = useCallback(async (ms: number) => {
    // Speech: update the simulation offset so progress continues from new position
    if (isSpeechRef.current) {
      if (speechOffsetRef.current) {
        speechOffsetRef.current = { startTime: Date.now(), offsetMs: ms };
      }
      setPositionMs(ms);
      return;
    }

    if (!soundRef.current) return;
    // Optimistic update so the bar doesn't snap back while the native seek completes
    setPositionMs(ms);
    setIsPlaying(true);
    // setStatusAsync atomically seeks AND resumes playback — more reliable on native
    // than calling setPositionAsync (which can leave audio paused on some devices).
    await soundRef.current
      .setStatusAsync({ positionMillis: ms, shouldPlay: true })
      .catch(() => undefined);
  }, []);

  const dismiss = useCallback(async () => {
    await _unload();
    setIsBarVisible(false);
    setIsPlaying(false);
    setStory(null);
    setPositionMs(0);
    setDurationMs(0);
  }, [_unload]);

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
