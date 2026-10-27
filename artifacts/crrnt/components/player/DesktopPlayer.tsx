import { useEffect, useMemo, useState } from "react";
import { Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { BlurView } from "expo-blur";
import { router } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useAudio } from "@/contexts/AudioContext";
import { useNavChrome } from "@/contexts/NavChromeContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { getCategoryMeta } from "@/constants/categories";
import type { ThemeColors } from "@/constants/theme";
import StoryImage from "@/components/StoryImage";
import WaveBars from "@/components/player/WaveBars";
import Scrubber from "@/components/player/Scrubber";
import { QueuePanel } from "@/components/player/QueueSheet";
import { DESKTOP, desktopBarFrame } from "@/hooks/useLayoutMode";
import { usePlayerDock } from "@/hooks/usePlayerDock";
import { formatTime } from "@/utils/formatTime";
import { formatRelativeTime } from "@/utils/time";
import { sourceDomain } from "@/utils/url";

const clamp01 = (x: number) => {
  "worklet";
  return Math.max(0, Math.min(1, x));
};

/** Full-panel geometry: fills the window (minus the queue panel) with a margin. */
function fullFrame(w: number, h: number, queueInset: number) {
  "worklet";
  const fw = w - DESKTOP.margin - Math.max(DESKTOP.margin, queueInset);
  const fh = h - DESKTOP.margin * 2;
  const art = Math.max(120, Math.min(fh - 96, (fw - 96) * 0.44, 560));
  return { fw, fh, art };
}

/**
 * Desktop player: a glass bar parked bottom-right that expands into a large
 * panel — artwork left, details and controls right. Space toggles playback,
 * Esc collapses the panel or closes the queue.
 */
export default function DesktopPlayer() {
  const { story, isPlaying, positionMs, durationMs, isBarVisible, queue, togglePlayPause, seekTo } =
    useAudio();
  const { expand, queue: queueAnim, isPlayerOpen, openPlayer, closePlayer, isQueueOpen, setQueueOpen } =
    useNavChrome();
  const { theme, isDark } = useThemeContext();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width: W, height: H } = useWindowDimensions();
  const { visible } = usePlayerDock();
  const [hover, setHover] = useState(false);

  const slide = useSharedValue(160);

  useEffect(() => {
    slide.value = withSpring(visible ? 0 : 160, { stiffness: 260, damping: 30 });
    if (!visible) closePlayer();
  }, [visible, slide, closePlayer]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.code === "Space" && visible) {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === "Escape") {
        if (isPlayerOpen) closePlayer();
        else if (isQueueOpen) setQueueOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, togglePlayPause, isPlayerOpen, closePlayer, isQueueOpen, setQueueOpen]);

  const R = (q: number) => {
    "worklet";
    return q * (DESKTOP.queueW + 28);
  };

  const shellStyle = useAnimatedStyle(() => {
    const P = clamp01(expand.value);
    const r = R(queueAnim.value);
    const bar = desktopBarFrame(W, r);
    const { fw, fh } = fullFrame(W, H, r);
    return {
      left: bar.left + (DESKTOP.margin - bar.left) * P,
      bottom: bar.bottom + (DESKTOP.margin - bar.bottom) * P,
      width: bar.width + (fw - bar.width) * P,
      height: DESKTOP.barH + (fh - DESKTOP.barH) * Math.min(expand.value, 1.03),
      borderRadius: DESKTOP.barH / 2 + (28 - DESKTOP.barH / 2) * P,
      transform: [{ translateY: slide.value }],
    };
  });

  const tintStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      clamp01(expand.value),
      [0, 1],
      [theme.bgElevated + (isDark ? "BD" : "CC"), theme.bgElevated],
    ),
  }));

  const glowStyle = useAnimatedStyle(() => ({ opacity: clamp01(expand.value) }));

  const artStyle = useAnimatedStyle(() => {
    const P = clamp01(expand.value);
    const { fh, art } = fullFrame(W, H, R(queueAnim.value));
    const size = 44 + (art - 44) * P;
    return {
      left: 10 + 38 * P,
      top: 10 + ((fh - art) / 2 - 10) * P,
      width: size,
      height: size,
      borderRadius: 11 + 13 * P,
      shadowOpacity: P * 0.5,
    };
  });

  const miniStyle = useAnimatedStyle(() => ({ opacity: clamp01(1 - expand.value * 4) }));

  const fullStyle = useAnimatedStyle(() => ({ opacity: clamp01((clamp01(expand.value) - 0.45) * 2.2) }));

  const columnStyle = useAnimatedStyle(() => {
    const { art } = fullFrame(W, H, R(queueAnim.value));
    return {
      left: 48 + art + 56,
      transform: [{ translateY: (1 - clamp01(expand.value)) * 30 }],
    };
  });

  const dimStyle = useAnimatedStyle(() => ({ opacity: clamp01(expand.value) * 0.7 }));

  if (!story && !isBarVisible) return <QueuePanel />;

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

  const toggleQueue = () => setQueueOpen(!isQueueOpen);

  return (
    <>
      <Animated.View style={[styles.dim, dimStyle]} pointerEvents={isPlayerOpen ? "auto" : "none"}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closePlayer} accessibilityLabel="Collapse player" />
      </Animated.View>

      <Animated.View style={[styles.shell, { borderColor: theme.borderStrong + "AA" }, shellStyle]}>
        <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        <Animated.View style={[StyleSheet.absoluteFill, tintStyle]} />
        <Animated.View style={[StyleSheet.absoluteFill, glowStyle]} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="dp-glow" cx="20%" cy="50%" rx="70%" ry="90%">
                <Stop offset="0" stopColor={catColor} stopOpacity={isDark ? 0.3 : 0.2} />
                <Stop offset="1" stopColor={catColor} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#dp-glow)" />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.art, artStyle]}>
          <StoryImage uri={story?.media_url} category={story?.category} style={StyleSheet.absoluteFill} />
          <Animated.View style={[styles.artScrim, miniStyle]}>
            <WaveBars isPlaying={isPlaying} color="#fff" />
          </Animated.View>
          {!isPlayerOpen ? (
            <Pressable style={StyleSheet.absoluteFill} onPress={openPlayer} accessibilityLabel="Expand player" />
          ) : null}
        </Animated.View>

        {/* Bar */}
        <Animated.View style={[styles.bar, miniStyle]} pointerEvents={isPlayerOpen ? "none" : "auto"}>
          <Pressable
            style={[StyleSheet.absoluteFill, { cursor: "pointer" } as object]}
            onPress={openPlayer}
            onHoverIn={() => setHover(true)}
            onHoverOut={() => setHover(false)}
            accessibilityLabel="Expand player"
          />
          <View style={styles.barTitle} pointerEvents="none">
            <Text style={styles.barTitleText} numberOfLines={1}>
              {story?.title ?? ""}
            </Text>
            <Text style={styles.barMeta} numberOfLines={1}>
              <Text style={{ color: catColor }}>{meta?.label ?? ""}</Text>
              {durationMs > 0 ? ` · ${formatTime(positionMs)} / ${formatTime(durationMs)}` : ""}
            </Text>
          </View>
          <HoverScale style={styles.barPlay} onPress={togglePlayPause} label={isPlaying ? "Pause (Space)" : "Play (Space)"}>
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={16}
              color={theme.bg}
              style={isPlaying ? undefined : { marginLeft: 2 }}
            />
          </HoverScale>
          <Pressable
            onPress={toggleQueue}
            style={({ hovered }) => [
              styles.queueChip,
              isQueueOpen
                ? { backgroundColor: theme.warning + "29" }
                : hovered
                  ? { backgroundColor: theme.text + "14" }
                  : null,
            ]}
            accessibilityLabel="Queue"
          >
            <Ionicons name="list" size={20} color={isQueueOpen ? theme.warning : theme.textMuted} />
            {queue.length > 0 ? (
              <Text style={[styles.queueCount, { color: isQueueOpen ? theme.warning : theme.textMuted }]}>
                {queue.length}
              </Text>
            ) : null}
          </Pressable>
          <Pressable onPress={openPlayer} style={styles.expandBtn} accessibilityLabel="Expand player">
            <Ionicons name="chevron-up" size={22} color={hover ? theme.text : theme.textMuted} />
          </Pressable>
          <View style={styles.barRail} pointerEvents="none">
            <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
          </View>
        </Animated.View>

        {/* Expanded panel */}
        <Animated.View style={[StyleSheet.absoluteFill, fullStyle]} pointerEvents={isPlayerOpen ? "box-none" : "none"}>
          <View style={styles.fullTop}>
            <Pressable
              onPress={toggleQueue}
              style={[styles.topBtn, isQueueOpen && { backgroundColor: theme.warning + "24" }]}
              accessibilityLabel="Queue"
            >
              <Ionicons name="list" size={20} color={isQueueOpen ? theme.warning : theme.textMuted} />
            </Pressable>
            <Pressable onPress={closePlayer} style={styles.topBtn} accessibilityLabel="Collapse (Esc)">
              <Ionicons name="chevron-down" size={22} color={theme.textMuted} />
            </Pressable>
          </View>

          <Animated.View style={[styles.column, columnStyle]}>
            <Text style={styles.eyebrow}>
              NOW PLAYING · <Text style={{ color: catColor }}>{(meta?.label ?? "").toUpperCase()}</Text>
            </Text>
            <View>
              <Text style={styles.fullTitle} numberOfLines={4}>
                {story?.title}
              </Text>
              <Text style={styles.fullSource}>
                {sourceDomain(story?.source_url)}
                {story?.published_at ? ` · ${formatRelativeTime(story.published_at)}` : ""}
              </Text>
            </View>
            {story?.one_liner ? (
              <Text style={styles.dek} numberOfLines={4}>
                {story.one_liner}
              </Text>
            ) : null}
            <Scrubber
              positionMs={positionMs}
              durationMs={durationMs}
              seekTo={seekTo}
              fillColor={theme.accent}
              railColor={theme.text + "24"}
              labelColor={theme.textMuted}
            />
            <View style={styles.controls}>
              <Pressable onPress={() => skip(-15000)} accessibilityLabel="Back 15 seconds">
                <MaterialCommunityIcons name="rewind-15" size={32} color={theme.text} />
              </Pressable>
              <HoverScale style={styles.bigPlay} onPress={togglePlayPause} label={isPlaying ? "Pause" : "Play"}>
                <Ionicons
                  name={isPlaying ? "pause" : "play"}
                  size={28}
                  color={theme.bg}
                  style={isPlaying ? undefined : { marginLeft: 3 }}
                />
              </HoverScale>
              <Pressable onPress={() => skip(15000)} accessibilityLabel="Forward 15 seconds">
                <MaterialCommunityIcons name="fast-forward-15" size={32} color={theme.text} />
              </Pressable>
            </View>
            <View style={styles.extras}>
              <ExtraButton icon="document-text-outline" label="Read" onPress={openStory} theme={theme} styles={styles} />
              <ExtraButton icon="share-outline" label="Share" onPress={share} theme={theme} styles={styles} />
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      <QueuePanel />
    </>
  );
}

function HoverScale({
  style,
  onPress,
  label,
  children,
}: {
  style: object;
  onPress: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ hovered, pressed }) => [
        style,
        { transform: [{ scale: pressed ? 0.95 : hovered ? 1.06 : 1 }] },
      ]}
    >
      {children}
    </Pressable>
  );
}

function ExtraButton({
  icon,
  label,
  onPress,
  theme,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  theme: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered }) => [styles.extraBtn, hovered && { backgroundColor: theme.text + "1F" }]}
    >
      <Ionicons name={icon} size={15} color={theme.textMuted} />
      <Text style={styles.extraText}>{label}</Text>
    </Pressable>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "#05070B", zIndex: 20 },
    shell: {
      position: "absolute",
      zIndex: 30,
      overflow: "hidden",
      borderWidth: 1,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.5,
      shadowRadius: 40,
    },
    art: {
      position: "absolute",
      overflow: "hidden",
      backgroundColor: theme.surfaceHigh,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 24 },
      shadowRadius: 50,
    },
    artScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    bar: {
      position: "absolute",
      top: 0,
      left: 64,
      right: 8,
      height: DESKTOP.barH,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    barTitle: { flex: 1, minWidth: 0, gap: 2 },
    barTitleText: { fontFamily: "Inter_600SemiBold", fontSize: 14.5, color: theme.text },
    barMeta: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: theme.textMuted,
      fontVariant: ["tabular-nums"],
    },
    barPlay: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.text,
      alignItems: "center",
      justifyContent: "center",
    },
    queueChip: {
      height: 34,
      paddingHorizontal: 12,
      borderRadius: 17,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    queueCount: { fontFamily: "Inter_700Bold", fontSize: 13 },
    expandBtn: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
    barRail: {
      position: "absolute",
      left: -32,
      right: 24,
      bottom: 0,
      height: 2,
      backgroundColor: theme.text + "14",
    },
    barFill: { height: "100%", backgroundColor: theme.accent, borderRadius: 1 },
    fullTop: { position: "absolute", top: 18, right: 18, flexDirection: "row", gap: 6, zIndex: 2 },
    topBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.text + "0D",
      alignItems: "center",
      justifyContent: "center",
    },
    column: {
      position: "absolute",
      top: 48,
      bottom: 48,
      right: 56,
      maxWidth: 620,
      justifyContent: "center",
      gap: 22,
    },
    eyebrow: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1.5, color: theme.textMuted },
    fullTitle: { fontFamily: "Inter_700Bold", fontSize: 32, lineHeight: 37, letterSpacing: -0.3, color: theme.text },
    fullSource: { fontFamily: "Inter_400Regular", fontSize: 14, color: theme.textMuted, marginTop: 10 },
    dek: { fontFamily: "Inter_400Regular", fontSize: 17, lineHeight: 25, color: theme.textMuted },
    controls: { flexDirection: "row", alignItems: "center", gap: 30 },
    bigPlay: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: theme.text,
      alignItems: "center",
      justifyContent: "center",
    },
    extras: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    extraBtn: {
      height: 36,
      paddingHorizontal: 15,
      borderRadius: 18,
      backgroundColor: theme.text + "12",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    extraText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: theme.textMuted },
  });
}
