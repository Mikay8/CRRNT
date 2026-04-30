import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef } from "react";
import { useAudio } from "@/contexts/AudioContext";
import palette from "@/constants/colors";

// Default RN tab bar height (safe area is added separately)
const TAB_BAR_HEIGHT = 49;

export default function MiniAudioBar() {
  const { story, isPlaying, positionMs, durationMs, isBarVisible, togglePlayPause, dismiss } =
    useAudio();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const slideAnim = useRef(new Animated.Value(120)).current;

  const isInTabs = segments[0] === "(tabs)";
  const isOnStory = segments[0] === "story";

  // Hide bar on story detail (it has its own full controls)
  const shouldShow = isBarVisible && !!story && !isOnStory;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: shouldShow ? 0 : 120,
      useNativeDriver: true,
      tension: 68,
      friction: 11,
    }).start();
  }, [shouldShow, slideAnim]);

  // Keep mounted so the slide-out animation can play
  if (!story && !isBarVisible) return null;

  const progress = durationMs > 0 ? positionMs / durationMs : 0;
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
      {/* Progress track along the top edge */}
      <View style={styles.progressTrack} pointerEvents="none">
        <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
      </View>

      {/* Main row — tapping navigates to story */}
      <Pressable
        onPress={handleBarPress}
        style={({ pressed }) => [styles.inner, { opacity: pressed ? 0.85 : 1 }]}
      >
        {/* Story title + time */}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {story?.title ?? ""}
          </Text>
          {durationMs > 0 ? (
            <Text style={styles.time}>
              {formatMs(positionMs)} / {formatMs(durationMs)}
            </Text>
          ) : null}
        </View>

        {/* Play / Pause */}
        <Pressable
          onPress={togglePlayPause}
          hitSlop={12}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={22}
            color={palette.text}
          />
        </Pressable>

        {/* Dismiss */}
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
    height: 2,
    backgroundColor: palette.border,
    width: "100%",
  },
  progressFill: {
    height: "100%",
    backgroundColor: palette.accent,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
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
