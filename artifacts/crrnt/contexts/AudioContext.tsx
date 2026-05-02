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
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechOffsetRef = useRef<{ startTime: number; offsetMs: number } | null>(null);

  const _unload = useCallback(async () => {
    // Stop position polling
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    // Stop speech simulation timer
    if (speechTimerRef.current) {
      clearInterval(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    speechOffsetRef.current = null;
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

        soundRef.current = sound;

        // Poll getStatusAsync every 200ms — more reliable than setOnPlaybackStatusUpdate
        // on the Expo mobile runtime, which frequently drops callbacks.
        pollingTimerRef.current = setInterval(async () => {
          if (!soundRef.current) {
            clearInterval(pollingTimerRef.current!);
            pollingTimerRef.current = null;
            return;
          }
          const status = await sound.getStatusAsync().catch(() => null);
          if (!status || !status.isLoaded) return;
          setPositionMs(status.positionMillis ?? 0);
          if (status.durationMillis) setDurationMs(status.durationMillis);
          if (status.isPlaying !== undefined) setIsPlaying(status.isPlaying);
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPositionMs(0);
            clearInterval(pollingTimerRef.current!);
            pollingTimerRef.current = null;
            soundRef.current?.unloadAsync().catch(() => undefined);
            soundRef.current = null;
          }
        }, 200);
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
            clearInterval(speechTimerRef.current!);
            speechTimerRef.current = null;
            return;
          }
          const elapsed = Date.now() - offset.startTime + offset.offsetMs;
          setPositionMs(Math.min(elapsed, estimatedMs));
        }, 200);

        const onEnd = () => {
          setIsPlaying(false);
          isSpeechRef.current = false;
          if (speechTimerRef.current) {
            clearInterval(speechTimerRef.current);
            speechTimerRef.current = null;
          }
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
      if (speechTimerRef.current) {
        clearInterval(speechTimerRef.current);
        speechTimerRef.current = null;
      }
      return;
    }

    if (!soundRef.current) return;
    const status = await soundRef.current.getStatusAsync().catch(() => null);
    if (!status || !status.isLoaded) return;

    if (status.isPlaying) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
    } else {
      await soundRef.current.playAsync();
      setIsPlaying(true);
    }
  }, []);

  const seekTo = useCallback(async (ms: number) => {
    if (isSpeechRef.current) {
      if (speechOffsetRef.current) {
        speechOffsetRef.current = { startTime: Date.now(), offsetMs: ms };
      }
      setPositionMs(ms);
      return;
    }

    if (!soundRef.current) return;
    // Optimistic update so the scrubber doesn't snap back during the native seek
    setPositionMs(ms);
    setIsPlaying(true);
    await soundRef.current.setPositionAsync(ms).catch(() => undefined);
    await soundRef.current.playAsync().catch(() => undefined);
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
