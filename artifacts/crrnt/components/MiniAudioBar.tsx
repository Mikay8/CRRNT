import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useAudio } from "@/contexts/AudioContext";
import { getCategoryMeta } from "@/constants/categories";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";
import QueueScreen from "@/components/QueueScreen";

const TAB_BAR_HEIGHT = 49;
const BAR_HEIGHT = 4;
const TRACK_HIT = 32;
const THUMB_R = 6;
const THUMB_R_ACTIVE = 8;

function WaveBar({ delay, isPlaying, color }: { delay: number; isPlaying: boolean; color: string }) {
  const anim = useRef(new Animated.Value(0.35)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isPlaying) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 380 + delay,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.25,
            duration: 380 + delay,
            useNativeDriver: true,
          }),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      Animated.timing(anim, {
        toValue: 0.35,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    return () => loopRef.current?.stop();
  }, [isPlaying, anim, delay]);

  return (
    <Animated.View
      style={[
        waveStyles.bar,
        { backgroundColor: color, transform: [{ scaleY: anim }] },
      ]}
    />
  );
}

const waveStyles = StyleSheet.create({
  bar: {
    width: 3,
    height: 18,
    borderRadius: 2,
  },
});

export default function MiniAudioBar() {
  const {
    story,
    isPlaying,
    positionMs,
    durationMs,
    isBarVisible,
    togglePlayPause,
    seekTo,
    dismiss,
  } = useAudio();

  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const slideAnim = useRef(new Animated.Value(140)).current;

  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const scrubRef = useRef<number | null>(null);
  const seekHoldRef = useRef<number | null>(null);
  const durationMsRef = useRef(durationMs);
  const seekToRef = useRef(seekTo);

  const [showQueue, setShowQueue] = useState(false);

  useEffect(() => { durationMsRef.current = durationMs; }, [durationMs]);
  useEffect(() => { seekToRef.current = seekTo; }, [seekTo]);

  const isInTabs = segments[0] === "(tabs)";
  const isOnStory = segments[0] === "story";
  const shouldShow = isBarVisible && !!story && !isOnStory;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: shouldShow ? 0 : 140,
      useNativeDriver: true,
      tension: 72,
      friction: 12,
    }).start();
  }, [shouldShow, slideAnim]);

  // Close queue if bar hides
  useEffect(() => {
    if (!shouldShow) setShowQueue(false);
  }, [shouldShow]);

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  // Tap gesture: jump to tapped position
  const tapSeekGesture = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, success) => {
      if (!success || trackWidthRef.current === 0 || durationMsRef.current === 0) return;
      const p = clamp(e.x / trackWidthRef.current);
      seekHoldRef.current = p;
      seekToRef.current(p * durationMsRef.current).catch(() => undefined);
    });

  // Pan gesture: scrub by dragging
  const panSeekGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(3)
    .onBegin((e) => {
      if (trackWidthRef.current === 0) return;
      const p = clamp(e.x / trackWidthRef.current);
      scrubRef.current = p;
      setScrubProgress(p);
    })
    .onUpdate((e) => {
      if (trackWidthRef.current === 0) return;
      const p = clamp(e.x / trackWidthRef.current);
      scrubRef.current = p;
      setScrubProgress(p);
    })
    .onEnd(() => {
      const p = scrubRef.current;
      if (p !== null && durationMsRef.current > 0) {
        seekHoldRef.current = p;
        seekToRef.current(p * durationMsRef.current).catch(() => undefined);
      }
      scrubRef.current = null;
      setScrubProgress(null);
    })
    .onFinalize(() => {
      scrubRef.current = null;
      setScrubProgress(null);
    });

  const seekGesture = Gesture.Race(tapSeekGesture, panSeekGesture);

  if (!story && !isBarVisible) return null;

  const liveProgress = durationMs > 0 ? positionMs / durationMs : 0;

  if (seekHoldRef.current !== null && durationMs > 0) {
    const targetMs = seekHoldRef.current * durationMs;
    if (Math.abs(positionMs - targetMs) < 1500) {
      seekHoldRef.current = null;
    }
  }

  const heldProgress = seekHoldRef.current;
  const displayProgress =
    scrubProgress !== null ? scrubProgress : heldProgress !== null ? heldProgress : liveProgress;
  const displayMs =
    scrubProgress !== null
      ? scrubProgress * durationMs
      : heldProgress !== null
        ? heldProgress * durationMs
        : positionMs;
  const bottomOffset = insets.bottom + (isInTabs ? TAB_BAR_HEIGHT : 0);
  const barBottom = bottomOffset + 8;

  const categoryMeta = getCategoryMeta(story?.category ?? null);
  const categoryColor = categoryMeta?.color ?? palette.accent;

  const thumbX = trackWidth * displayProgress;

  return (
    <>
      <Animated.View
        style={[
          styles.wrapper,
          { bottom: barBottom, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Main content row — tap to open queue */}
        <Pressable
          onPress={() => setShowQueue(true)}
          style={({ pressed }) => [styles.inner, { opacity: pressed ? 0.88 : 1 }]}
        >
          {/* Waveform animation */}
          <View style={styles.waveContainer} pointerEvents="none">
            <WaveBar delay={0}   isPlaying={isPlaying} color={palette.accent} />
            <WaveBar delay={80}  isPlaying={isPlaying} color={palette.accent} />
            <WaveBar delay={160} isPlaying={isPlaying} color={palette.accent} />
            <WaveBar delay={40}  isPlaying={isPlaying} color={palette.accent} />
          </View>

          {/* Title + time */}
          <View style={styles.info}>
            <Text style={styles.titleText} numberOfLines={1}>
              {story?.title ?? ""}
            </Text>
            <Text style={styles.timeText}>
              {durationMs > 0
                ? `${formatMs(displayMs)} / ${formatMs(durationMs)}`
                : categoryMeta?.label ?? ""}
            </Text>
          </View>

          {/* Play / pause */}
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); togglePlayPause(); }}
            hitSlop={12}
            style={({ pressed }) => [
              styles.playBtn,
              { backgroundColor: categoryColor, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={17}
              color="#fff"
              style={isPlaying ? undefined : { marginLeft: 2 }}
            />
          </Pressable>

          {/* Dismiss */}
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); dismiss(); }}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Ionicons name="close" size={16} color={palette.textDim} />
          </Pressable>
        </Pressable>

        {/* Scrubable progress bar — tap or drag */}
        <GestureDetector gesture={seekGesture}>
          <View
            style={styles.progressTrack}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              trackWidthRef.current = w;
              setTrackWidth(w);
            }}
          >
            <View style={styles.progressRail} />
            <View
              style={[
                styles.progressFill,
                {
                  width: Math.min(displayProgress * trackWidth, trackWidth),
                  backgroundColor: categoryColor,
                },
              ]}
            />
            {trackWidth > 0 && (
              <View
                style={[
                  styles.progressThumb,
                  scrubProgress !== null && styles.progressThumbActive,
                  {
                    left: thumbX - (scrubProgress !== null ? THUMB_R_ACTIVE : THUMB_R),
                    backgroundColor: categoryColor,
                  },
                ]}
              />
            )}
          </View>
        </GestureDetector>
      </Animated.View>

      <QueueScreen
        visible={showQueue}
        onClose={() => setShowQueue(false)}
        barBottom={barBottom}
      />
    </>
  );
}

function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    wrapper: {
      position: "absolute",
      left: 10,
      right: 10,
      borderRadius: 20,
      backgroundColor: palette.surfaceHigh,
      borderWidth: 1,
      borderColor: palette.borderStrong,
      overflow: "hidden",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.45,
      shadowRadius: 20,
      elevation: 16,
    },
    inner: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 10,
      gap: 10,
    },
    waveContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      width: 22,
    },
    info: {
      flex: 1,
      gap: 2,
    },
    titleText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: palette.text,
      letterSpacing: -0.1,
    },
    timeText: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: palette.textMuted,
    },
    playBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    closeBtn: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    progressTrack: {
      height: TRACK_HIT,
      width: "100%",
      justifyContent: "center",
    },
    progressRail: {
      position: "absolute",
      left: 0,
      right: 0,
      height: BAR_HEIGHT,
      backgroundColor: palette.border,
    },
    progressFill: {
      position: "absolute",
      left: 0,
      height: BAR_HEIGHT,
    },
    progressThumb: {
      position: "absolute",
      width: THUMB_R * 2,
      height: THUMB_R * 2,
      borderRadius: THUMB_R,
      top: (TRACK_HIT - THUMB_R * 2) / 2,
    },
    progressThumbActive: {
      width: THUMB_R_ACTIVE * 2,
      height: THUMB_R_ACTIVE * 2,
      borderRadius: THUMB_R_ACTIVE,
      top: (TRACK_HIT - THUMB_R_ACTIVE * 2) / 2,
    },
  });
}
