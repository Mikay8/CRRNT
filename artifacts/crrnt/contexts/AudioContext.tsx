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
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks elapsed-time simulation for expo-speech (no native position API)
  const speechTimerRef = useRef<{ startTime: number; offsetMs: number } | null>(null);

  const _clearInterval = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const _unload = useCallback(async () => {
    _clearInterval();
    speechTimerRef.current = null;
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
          (status) => {
            if (!status.isLoaded) return;
            if (status.didJustFinish) {
              setIsPlaying(false);
              setPositionMs(0);
              _clearInterval();
              soundRef.current?.unloadAsync().catch(() => undefined);
              soundRef.current = null;
            }
          },
        );
        sound.setProgressUpdateIntervalAsync(200).catch(() => undefined);
        soundRef.current = sound;

        // Poll every 200ms — reliable cross-device source of truth for position/duration
        progressIntervalRef.current = setInterval(async () => {
          const s = soundRef.current;
          if (!s) return;
          const status = await s.getStatusAsync();
          if (!status.isLoaded) return;
          setPositionMs(status.positionMillis ?? 0);
          if (status.durationMillis) setDurationMs(status.durationMillis);
        }, 200);
      } else {
        // expo-speech fallback: simulate progress with elapsed time
        isSpeechRef.current = true;
        const text = buildSpeechText(newStory);
        // ~2.3 words/sec at rate 0.9 (~138 wpm)
        const estimatedMs = Math.max(Math.round((text.split(/\s+/).length / 2.3) * 1000), 5000);
        setDurationMs(estimatedMs);
        speechTimerRef.current = { startTime: Date.now(), offsetMs: 0 };

        progressIntervalRef.current = setInterval(() => {
          const timer = speechTimerRef.current;
          if (!timer || !isSpeechRef.current) {
            _clearInterval();
            return;
          }
          const elapsed = Date.now() - timer.startTime + timer.offsetMs;
          setPositionMs(Math.min(elapsed, estimatedMs));
        }, 200);

        const _onSpeechEnd = () => {
          setIsPlaying(false);
          isSpeechRef.current = false;
          speechTimerRef.current = null;
          _clearInterval();
        };

        Speech.speak(text, {
          language: "en-US",
          rate: 0.9,
          pitch: 1.0,
          volume: 1.0,
          onDone: _onSpeechEnd,
          onError: _onSpeechEnd,
          onStopped: _onSpeechEnd,
        });
      }
    },
    [_unload],
  );

  const togglePlayPause = useCallback(async () => {
    if (isSpeechRef.current) {
      // expo-speech has no pause — stop and clear timer
      Speech.stop();
      setIsPlaying(false);
      isSpeechRef.current = false;
      speechTimerRef.current = null;
      _clearInterval();
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
    // Speech path: update simulated timer offset so progress continues from new position
    if (isSpeechRef.current) {
      if (speechTimerRef.current) {
        speechTimerRef.current = { startTime: Date.now(), offsetMs: ms };
      }
      setPositionMs(ms);
      return;
    }

    if (!soundRef.current) return;
    // Update UI immediately so the bar doesn't snap back while the async seek completes
    setPositionMs(ms);
    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;
    const clamped = Math.max(0, Math.min(ms, status.durationMillis ?? ms));
    if (clamped !== ms) setPositionMs(clamped);
    await soundRef.current.setPositionAsync(clamped);
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
