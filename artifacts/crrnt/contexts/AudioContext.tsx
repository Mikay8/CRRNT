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
  const [isBarVisible, setIsBarVisible] = useState(false);

  // Which source is driving the exposed state
  const [isAudioMode, setIsAudioMode] = useState(false);
  // Ref copy so callbacks never have a stale closure on this flag
  const isAudioModeRef = useRef(false);

  // Speech-mode state (expo-speech has no native position API)
  const [speechPositionMs, setSpeechPositionMs] = useState(0);
  const [speechDurationMs, setSpeechDurationMs] = useState(0);
  const [speechPlaying, setSpeechPlaying] = useState(false);
  const speechTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechOffsetRef = useRef<{ startTime: number; offsetMs: number } | null>(null);

  // Single player instance — lives for the lifetime of the provider.
  // 200ms update interval keeps the scrubber smooth.
  const player = useAudioPlayer(null, 200);
  const audioStatus = useAudioPlayerStatus(player);

  const _setAudioMode = (val: boolean) => {
    isAudioModeRef.current = val;
    setIsAudioMode(val);
  };

  // Derived values exposed to context consumers
  const positionMs = isAudioMode
    ? Math.round((audioStatus.currentTime ?? 0) * 1000)
    : speechPositionMs;
  const durationMs = isAudioMode
    ? Math.round((audioStatus.duration ?? 0) * 1000)
    : speechDurationMs;
  const isPlaying = isAudioMode ? (audioStatus.playing ?? false) : speechPlaying;

  // When audio finishes, reset position to 0
  useEffect(() => {
    if (audioStatus.didJustFinish) {
      // player stays loaded — scrubber snaps back to start
    }
  }, [audioStatus.didJustFinish]);

  const _stopSpeech = useCallback(() => {
    if (speechTimerRef.current) {
      clearInterval(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    speechOffsetRef.current = null;
    Speech.stop();
    setSpeechPlaying(false);
  }, []);

  const playStory = useCallback(
    async (newStory: Story) => {
      _stopSpeech();
      player.pause();
      _setAudioMode(false);

      setStory(newStory);
      setIsBarVisible(true);
      setSpeechPositionMs(0);
      setSpeechDurationMs(0);
      setSpeechPlaying(false);

      const audioUrl = (newStory as any).audioUrl as string | undefined;

      if (audioUrl) {
        const fullUrl = `${getBaseUrl() ?? ""}${audioUrl}`;

        await setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
        });

        _setAudioMode(true);
        player.replace({ uri: fullUrl });
        player.play();

        // Populate lock screen Now Playing info (iOS + Android media session)
        try {
          (player as any).nowPlayingInfo = {
            title: newStory.title,
            artist: "CRRNT",
            artworkUri: (newStory as any).mediaUrl ?? undefined,
          };
        } catch {}
      } else {
        // expo-speech fallback when no pre-generated audio exists
        _setAudioMode(false);
        setSpeechPlaying(true);

        const text = buildSpeechText(newStory);
        const estimatedMs = Math.max(
          Math.round((text.split(/\s+/).length / 2.3) * 1000),
          5000,
        );
        setSpeechDurationMs(estimatedMs);
        speechOffsetRef.current = { startTime: Date.now(), offsetMs: 0 };

        speechTimerRef.current = setInterval(() => {
          const offset = speechOffsetRef.current;
          if (!offset) {
            clearInterval(speechTimerRef.current!);
            speechTimerRef.current = null;
            return;
          }
          setSpeechPositionMs(
            Math.min(Date.now() - offset.startTime + offset.offsetMs, estimatedMs),
          );
        }, 200);

        const onEnd = () => {
          setSpeechPlaying(false);
          _stopSpeech();
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
    [player, _stopSpeech],
  );

  const togglePlayPause = useCallback(async () => {
    if (!isAudioModeRef.current) {
      _stopSpeech();
      return;
    }
    // player.playing is a live property on the AudioPlayer instance — always fresh
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  }, [player, _stopSpeech]);

  const seekTo = useCallback(
    async (ms: number) => {
      if (!isAudioModeRef.current) {
        if (speechOffsetRef.current) {
          speechOffsetRef.current = { startTime: Date.now(), offsetMs: ms };
        }
        setSpeechPositionMs(ms);
        return;
      }
      // expo-audio takes seconds, our interface uses ms
      player.seekTo(ms / 1000);
      player.play();
    },
    [player],
  );

  const dismiss = useCallback(async () => {
    _stopSpeech();
    player.pause();
    _setAudioMode(false);
    setIsBarVisible(false);
    setStory(null);
    setSpeechPositionMs(0);
    setSpeechDurationMs(0);
    setSpeechPlaying(false);
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
