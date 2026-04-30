import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import palette from "@/constants/colors";

const TAB_BAR_HEIGHT = 49;
const TRACK_HEIGHT = 14; // taller hit area, visually thinner bar inside

export default function MiniAudioBar() {
  const { story, isPlaying, positionMs, durationMs, isBarVisible, togglePlayPause, seekTo, dismiss } =
    useAudio();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const slideAnim = useRef(new Animated.Value(120)).current;

  // While scrubbing we show a local preview progress instead of positionMs
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const trackWidthRef = useRef(0);

  // Refs so PanResponder callbacks (created once) always see fresh values
  const durationMsRef = useRef(durationMs);
  const seekToRef = useRef(seekTo);
  useEffect(() => { durationMsRef.current = durationMs; }, [durationMs]);
  useEffect(() => { seekToRef.current = seekTo; }, [seekTo]);

  const isInTabs = segments[0] === "(tabs)";
  const isOnStory = segments[0] === "story";
  const shouldShow = isBarVisible && !!story && !isOnStory;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: shouldShow ? 0 : 120,
      useNativeDriver: true,
      tension: 68,
      friction: 11,
    }).start();
  }, [shouldShow, slideAnim]);

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const setScrubProgressRef = useRef(setScrubProgress);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (trackWidthRef.current === 0) return;
        const ratio = clamp(evt.nativeEvent.locationX / trackWidthRef.current);
        setScrubProgressRef.current(ratio);
      },
      onPanResponderMove: (evt) => {
        if (trackWidthRef.current === 0) return;
        const ratio = clamp(evt.nativeEvent.locationX / trackWidthRef.current);
        setScrubProgressRef.current(ratio);
      },
      onPanResponderRelease: (evt) => {
        if (trackWidthRef.current === 0) return;
        const ratio = clamp(evt.nativeEvent.locationX / trackWidthRef.current);
        seekToRef.current(ratio * durationMsRef.current);
        setScrubProgressRef.current(null);
      },
      onPanResponderTerminate: () => {
        setScrubProgressRef.current(null);
      },
    })
  ).current;

  if (!story && !isBarVisible) return null;

  const liveProgress = durationMs > 0 ? positionMs / durationMs : 0;
  const displayProgress = scrubProgress !== null ? scrubProgress : liveProgress;
  const displayMs = scrubProgress !== null ? scrubProgress * durationMs : positionMs;
  const bottomOffset = insets.bottom + (isInTabs ? TAB_BAR_HEIGHT : 0);

  const handleBarPress = () => {
    if (story) router.push(`/story/${story.articleId}` as any);
  };

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { bottom: bottomOffset, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {/* Scrubable progress track */}
      <View
        style={styles.progressTrack}
        onLayout={(e) => { trackWidthRef.current = e.nativeEvent.layout.width; }}
        {...panResponder.panHandlers}
      >
        <View style={styles.progressRail} />
        <View style={[styles.progressFill, { width: `${Math.min(displayProgress * 100, 100)}%` }]} />
        <View
          style={[
            styles.progressThumb,
            { left: `${Math.min(displayProgress * 100, 100)}%` as any },
            scrubProgress !== null && styles.progressThumbActive,
          ]}
        />
      </View>

      {/* Main row — tapping navigates to story */}
      <Pressable
        onPress={handleBarPress}
        style={({ pressed }) => [styles.inner, { opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {story?.title ?? ""}
          </Text>
          {durationMs > 0 ? (
            <Text style={styles.time}>
              {formatMs(displayMs)} / {formatMs(durationMs)}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={togglePlayPause}
          hitSlop={12}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name={isPlaying ? "pause" : "play"} size={22} color={palette.text} />
        </Pressable>

        <Pressable
          onPress={dismiss}
          hitSlop={12}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="close" size={20} color={palette.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 12,
    right: 12,
    paddingBottom: 4,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },
  progressTrack: {
    height: TRACK_HEIGHT,
    width: "100%",
    justifyContent: "center",
  },
  progressRail: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: palette.border,
  },
  progressFill: {
    position: "absolute",
    left: 0,
    height: 2,
    backgroundColor: palette.accent,
  },
  progressThumb: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.accent,
    marginLeft: -5,
    top: (TRACK_HEIGHT - 10) / 2,
  },
  progressThumbActive: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    top: (TRACK_HEIGHT - 14) / 2,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
    gap: 10,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: palette.text,
  },
  time: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: palette.textMuted,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
});
