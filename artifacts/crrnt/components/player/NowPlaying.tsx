import { useEffect, useMemo } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { router } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useAudio, useAudioProgress } from "@/contexts/AudioContext";
import { EXPAND_SPRING, NAV, useNavChrome, useTabBarBottom } from "@/contexts/NavChromeContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { getCategoryMeta } from "@/constants/categories";
import type { ThemeColors } from "@/constants/theme";
import StoryImage from "@/components/StoryImage";
import WaveBars from "@/components/player/WaveBars";
import Scrubber from "@/components/player/Scrubber";
import QueueSheet from "@/components/player/QueueSheet";
import DesktopPlayer from "@/components/player/DesktopPlayer";
import { useIsDesktop } from "@/hooks/useLayoutMode";
import { miniFrame, usePlayerDock } from "@/hooks/usePlayerDock";
import { formatTime } from "@/utils/formatTime";
import { formatRelativeTime } from "@/utils/time";
import { sourceDomain } from "@/utils/url";

const clamp01 = (x: number) => {
  "worklet";
  return Math.max(0, Math.min(1, x));
};

/** The persistent player, in its desktop or mobile form. */
export default function NowPlaying() {
  return useIsDesktop() ? <DesktopPlayer /> : <MobilePlayer />;
}

/**
 * Mobile: a glass mini bar docked above (or, once the tab bar tucks away,
 * beside) the tab bar that drags or taps open into a full-screen player —
 * one surface morphing between both states on a single spring.
 */
function MobilePlayer() {
  const {
    story,
    isPlaying,
    isBarVisible,
    queue,
    togglePlayPause,
    seekTo,
    dismiss,
  } = useAudio();
  const { positionMs, durationMs } = useAudioProgress();
  const { collapse, expand, isPlayerOpen, openPlayer, closePlayer, syncPlayerOpen, setQueueOpen } =
    useNavChrome();
  const { theme, isDark } = useThemeContext();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const tabBottom = useTabBarBottom();
  const { inTabs, visible } = usePlayerDock();

  const slide = useSharedValue(160);
  const dragStart = useSharedValue(0);

  useEffect(() => {
    slide.value = withSpring(visible ? 0 : 160, { stiffness: 260, damping: 30 });
    if (!visible) closePlayer();
  }, [visible, slide, closePlayer]);

  useEffect(() => {
    if (!isPlayerOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closePlayer();
      return true;
    });
    return () => sub.remove();
  }, [isPlayerOpen, closePlayer]);

  const artTop = insets.top + 84;
  const artSize = Math.min(W - 64, H * 0.34);
  const bodyTop = artTop + artSize + 24;
  const fullRadius = Platform.OS === "ios" ? 44 : 0;

  const drag = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .failOffsetX([-15, 15])
    .onStart(() => {
      dragStart.value = expand.value;
    })
    .onUpdate((e) => {
      const m = miniFrame(collapse.value, inTabs, tabBottom);
      const dist = H - m.bottom - m.height;
      let p = dragStart.value - e.translationY / dist;
      if (p < 0) p *= 0.25;
      if (p > 1) p = 1 + (p - 1) * 0.15;
      expand.value = p;
    })
    .onEnd((e) => {
      const m = miniFrame(collapse.value, inTabs, tabBottom);
      const v = -e.velocityY / (H - m.bottom - m.height);
      const target = v > 1.2 ? 1 : v < -1.2 ? 0 : expand.value > 0.45 ? 1 : 0;
      expand.value = withSpring(target, { ...EXPAND_SPRING, velocity: v });
      runOnJS(syncPlayerOpen)(target === 1);
    });

  const shellStyle = useAnimatedStyle(() => {
    const P = clamp01(expand.value);
    const m = miniFrame(collapse.value, inTabs, tabBottom);
    return {
      left: m.left * (1 - P),
      right: NAV.inset * (1 - P),
      bottom: m.bottom * (1 - P),
      height: m.height + (H - m.height) * Math.min(expand.value, 1.05),
      borderRadius: m.height / 2 + (fullRadius - m.height / 2) * P,
      transform: [{ translateY: slide.value }],
    };
  });

  const tintStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      clamp01(expand.value),
      [0, 1],
      [theme.bgElevated + (isDark ? "B8" : "C8"), theme.bg],
    ),
  }));

  const glowStyle = useAnimatedStyle(() => ({ opacity: clamp01(expand.value) }));

  const artStyle = useAnimatedStyle(() => {
    const P = clamp01(expand.value);
    const aS = miniFrame(collapse.value, inTabs, tabBottom).height - 16;
    const size = aS + (artSize - aS) * P;
    return {
      left: 8 + (W / 2 - artSize / 2 - 8) * P,
      top: 8 + (artTop - 8) * P,
      width: size,
      height: size,
      borderRadius: aS / 4 + (22 - aS / 4) * P,
      shadowOpacity: P * 0.5,
    };
  });

  const miniStyle = useAnimatedStyle(() => {
    const h = miniFrame(collapse.value, inTabs, tabBottom).height;
    return {
      height: h,
      paddingLeft: h - 16 + 20,
      opacity: clamp01(1 - expand.value * 4),
    };
  });
  const miniOverlayStyle = useAnimatedStyle(() => ({ opacity: clamp01(1 - expand.value * 4) }));

  const fullStyle = useAnimatedStyle(() => {
    const P = clamp01(expand.value);
    return {
      opacity: clamp01((P - 0.45) * 2.2),
      transform: [{ translateY: (1 - P) * 40 }],
    };
  });

  const dimStyle = useAnimatedStyle(() => ({ opacity: clamp01(expand.value) * 0.5 }));

  if (!story && !isBarVisible) return null;

  const meta = getCategoryMeta(story?.category ?? null);
  const catColor = meta?.color ?? theme.accent;
  const progress = durationMs > 0 ? Math.min(positionMs / durationMs, 1) : 0;

  const skip = (deltaMs: number) => {
    if (durationMs <= 0) return;
    seekTo(Math.max(0, Math.min(durationMs, positionMs + deltaMs))).catch(() => undefined);
  };

  const openStory = () => {
    if (!story) return;
    closePlayer();
    router.push({ pathname: "/story/[id]", params: { id: story.id } });
  };

  const share = () => {
    if (!story) return;
    Share.share({ message: [story.title, story.source_url].filter(Boolean).join("\n") }).catch(
      () => undefined,
    );
  };

  return (
    <>
      <Animated.View style={[styles.dim, dimStyle]} pointerEvents="none" />

      <GestureDetector gesture={drag}>
        <Animated.View style={[styles.shell, { borderColor: theme.borderStrong + "AA" }, shellStyle]}>
          <BlurView
            intensity={Platform.OS === "android" ? 60 : 40}
            tint={isDark ? "dark" : "light"}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[StyleSheet.absoluteFill, tintStyle]} />
          <Animated.View style={[styles.glow, { width: W, height: H }, glowStyle]} pointerEvents="none">
            <Svg width={W} height={H}>
              <Defs>
                <RadialGradient id="np-glow" cx="50%" cy="22%" rx="70%" ry="45%">
                  <Stop offset="0" stopColor={catColor} stopOpacity={isDark ? 0.32 : 0.22} />
                  <Stop offset="1" stopColor={catColor} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect width={W} height={H} fill="url(#np-glow)" />
            </Svg>
          </Animated.View>

          {/* Artwork — a thumbnail in the mini bar, the hero in the full player */}
          <Animated.View style={[styles.art, artStyle]}>
            <StoryImage uri={story?.media_url} category={story?.category} style={StyleSheet.absoluteFill} />
            <Animated.View style={[styles.artScrim, miniOverlayStyle]}>
              <WaveBars isPlaying={isPlaying} color="#fff" />
            </Animated.View>
          </Animated.View>

          {/* Mini bar */}
          <Animated.View
            style={[styles.mini, miniStyle]}
            pointerEvents={isPlayerOpen ? "none" : "auto"}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={openPlayer} accessibilityLabel="Open player" />
            <View style={styles.miniText} pointerEvents="none">
              <Text style={styles.miniTitle} numberOfLines={1}>
                {story?.title ?? ""}
              </Text>
              <Text style={styles.miniTime}>
                {durationMs > 0
                  ? `${formatTime(positionMs)} / ${formatTime(durationMs)}`
                  : meta?.label ?? ""}
              </Text>
            </View>
            <Pressable
              onPress={togglePlayPause}
              hitSlop={8}
              style={({ pressed }) => [styles.miniPlay, { opacity: pressed ? 0.6 : 1 }]}
              accessibilityLabel={isPlaying ? "Pause" : "Play"}
            >
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={17}
                color={theme.text}
                style={isPlaying ? undefined : { marginLeft: 2 }}
              />
            </Pressable>
            <Pressable
              onPress={dismiss}
              hitSlop={8}
              style={({ pressed }) => [styles.miniClose, { opacity: pressed ? 0.5 : 1 }]}
              accessibilityLabel="Close player"
            >
              <Ionicons name="close" size={18} color={theme.textMuted} />
            </Pressable>
            <View style={styles.miniRail}>
              <View style={[styles.miniFill, { width: `${progress * 100}%` }]} />
            </View>
          </Animated.View>

          {/* Full player */}
          <Animated.View
            style={[styles.full, { width: W, height: H }, fullStyle]}
            pointerEvents={isPlayerOpen ? "box-none" : "none"}
          >
            <View style={[styles.handle, { top: insets.top + 8 }]} />
            <View style={[styles.fullHead, { top: insets.top + 24 }]}>
              <Pressable onPress={closePlayer} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Minimize player">
                <Ionicons name="chevron-down" size={26} color={theme.text} />
              </Pressable>
              <Text style={styles.eyebrow}>
                NOW PLAYING · <Text style={{ color: catColor }}>{(meta?.label ?? "").toUpperCase()}</Text>
              </Text>
              <Pressable onPress={openStory} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Open story">
                <Ionicons name="ellipsis-horizontal" size={22} color={theme.textMuted} />
              </Pressable>
            </View>

            <View style={[styles.fullBody, { top: bodyTop }]}>
              <View>
                <Text style={styles.fullTitle} numberOfLines={2}>
                  {story?.title}
                </Text>
                <Text style={styles.fullSource}>
                  {sourceDomain(story?.source_url)}
                  {story?.published_at ? ` · ${formatRelativeTime(story.published_at)}` : ""}
                </Text>
              </View>

              <Scrubber
                positionMs={positionMs}
                durationMs={durationMs}
                seekTo={seekTo}
                fillColor={theme.text}
                railColor={theme.text + "24"}
                labelColor={theme.textMuted}
              />

              <View style={styles.controls}>
                <Pressable onPress={() => skip(-15000)} hitSlop={10} accessibilityLabel="Back 15 seconds">
                  <MaterialCommunityIcons name="rewind-15" size={32} color={theme.text} />
                </Pressable>
                <Pressable
                  onPress={togglePlayPause}
                  style={({ pressed }) => [styles.bigPlay, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
                  accessibilityLabel={isPlaying ? "Pause" : "Play"}
                >
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={30}
                    color={theme.bg}
                    style={isPlaying ? undefined : { marginLeft: 3 }}
                  />
                </Pressable>
                <Pressable onPress={() => skip(15000)} hitSlop={10} accessibilityLabel="Forward 15 seconds">
                  <MaterialCommunityIcons name="fast-forward-15" size={32} color={theme.text} />
                </Pressable>
              </View>

              <View style={styles.extras}>
                <Pressable style={styles.extraBtn} onPress={openStory}>
                  <Ionicons name="document-text-outline" size={15} color={theme.textMuted} />
                  <Text style={styles.extraText}>Read</Text>
                </Pressable>
                <Pressable style={styles.extraBtn} onPress={() => setQueueOpen(true)}>
                  <Ionicons name="list" size={15} color={theme.textMuted} />
                  <Text style={styles.extraText}>Queue{queue.length ? ` · ${queue.length}` : ""}</Text>
                </Pressable>
                <Pressable style={styles.extraBtn} onPress={share}>
                  <Ionicons name="share-outline" size={15} color={theme.textMuted} />
                  <Text style={styles.extraText}>Share</Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      <QueueSheet />
    </>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    dim: { ...StyleSheet.absoluteFill, backgroundColor: "#000", zIndex: 25 },
    shell: {
      position: "absolute",
      zIndex: 30,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.4,
      shadowRadius: 24,
      elevation: 18,
    },
    glow: { position: "absolute", left: 0, top: 0 },
    art: {
      position: "absolute",
      overflow: "hidden",
      backgroundColor: theme.surfaceHigh,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 24 },
      shadowRadius: 40,
    },
    artScrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    mini: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingRight: 8,
    },
    miniText: { flex: 1, minWidth: 0, gap: 1 },
    miniTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: theme.text },
    miniTime: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: theme.textMuted,
      fontVariant: ["tabular-nums"],
    },
    miniPlay: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.text + "1A",
    },
    miniClose: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
    miniRail: {
      position: "absolute",
      left: NAV.miniH / 2,
      right: NAV.miniH / 2,
      bottom: 0,
      height: 2,
      backgroundColor: theme.text + "14",
    },
    miniFill: { height: "100%", backgroundColor: theme.accent, borderRadius: 1 },
    full: { position: "absolute", left: 0, top: 0 },
    handle: {
      position: "absolute",
      alignSelf: "center",
      left: "50%",
      marginLeft: -19,
      width: 38,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.text + "40",
    },
    fullHead: {
      position: "absolute",
      left: 20,
      right: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    eyebrow: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 11,
      letterSpacing: 1.5,
      color: theme.textMuted,
    },
    fullBody: { position: "absolute", left: 32, right: 32, gap: 16 },
    fullTitle: { fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 25, color: theme.text },
    fullSource: { fontFamily: "Inter_400Regular", fontSize: 14, color: theme.textMuted, marginTop: 6 },
    controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 36 },
    bigPlay: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.text,
      alignItems: "center",
      justifyContent: "center",
    },
    extras: { flexDirection: "row", justifyContent: "space-between" },
    extraBtn: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: 18,
      backgroundColor: theme.text + "12",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    extraText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: theme.textMuted },
  });
}
