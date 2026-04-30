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

  const _unload = useCallback(async () => {
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
            setPositionMs(status.positionMillis ?? 0);
            setDurationMs(status.durationMillis ?? 0);
            if (status.didJustFinish) {
              setIsPlaying(false);
              setPositionMs(0);
              soundRef.current?.unloadAsync().catch(() => undefined);
              soundRef.current = null;
            }
          },
        );
        soundRef.current = sound;
      } else {
        // expo-speech fallback — no progress tracking available
        isSpeechRef.current = true;
        const text = buildSpeechText(newStory);
        Speech.speak(text, {
          language: "en-US",
          rate: 0.9,
          pitch: 1.0,
          volume: 1.0,
          onDone: () => {
            setIsPlaying(false);
            isSpeechRef.current = false;
          },
          onError: () => {
            setIsPlaying(false);
            isSpeechRef.current = false;
          },
          onStopped: () => {
            setIsPlaying(false);
            isSpeechRef.current = false;
          },
        });
      }
    },
    [_unload],
  );

  const togglePlayPause = useCallback(async () => {
    if (isSpeechRef.current) {
      // expo-speech has no pause — stop only
      Speech.stop();
      setIsPlaying(false);
      isSpeechRef.current = false;
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
    if (!soundRef.current) return;
    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;
    await soundRef.current.setPositionAsync(Math.max(0, Math.min(ms, status.durationMillis ?? 0)));
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
