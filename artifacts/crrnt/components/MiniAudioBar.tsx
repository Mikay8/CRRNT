import {
  Animated,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
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
import type { Story } from "@workspace/api-client-react";

const TAB_BAR_HEIGHT = 49;
const BAR_HEIGHT = 4;
const TRACK_HIT = 32;
const THUMB_R = 6;
const THUMB_R_ACTIVE = 8;
const COLLAPSED_HEIGHT = 90;
const EXPAND_THRESHOLD = 60;
const DRAG_RANGE = 160;

function WaveBar({ delay, isPlaying, color }: { delay: number; isPlaying: boolean; color: string }) {
  const anim = useRef(new Animated.Value(0.35)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isPlaying) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 380 + delay, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.25, duration: 380 + delay, useNativeDriver: true }),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      Animated.timing(anim, { toValue: 0.35, duration: 200, useNativeDriver: true }).start();
    }
    return () => loopRef.current?.stop();
  }, [isPlaying, anim, delay]);

  return (
    <Animated.View
      style={[waveStyles.bar, { backgroundColor: color, transform: [{ scaleY: anim }] }]}
    />
  );
}

const waveStyles = StyleSheet.create({
  bar: { width: 3, height: 18, borderRadius: 2 },
});

function QueueItem({
  story,
  palette,
  onPlay,
  onRemove,
}: {
  story: Story;
  palette: ThemeColors;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const catMeta = getCategoryMeta(story.category);
  return (
    <Pressable
      onPress={onPlay}
      style={({ pressed }) => [queueItemStyles.item, { opacity: pressed ? 0.7 : 1 }]}
    >
      {story.media_url ? (
        <Image source={{ uri: story.media_url }} style={queueItemStyles.thumb} resizeMode="cover" />
      ) : (
        <View style={[queueItemStyles.thumb, { backgroundColor: palette.border }]} />
      )}
      <View style={queueItemStyles.info}>
        <Text style={[queueItemStyles.title, { color: palette.text }]} numberOfLines={2}>
          {story.title}
        </Text>
        <Text style={[queueItemStyles.meta, { color: palette.textDim }]}>
          {catMeta?.label ?? story.category}
        </Text>
      </View>
      <Pressable
        onPress={(e) => { e.stopPropagation?.(); onRemove(); }}
        hitSlop={10}
        style={({ pressed }) => [queueItemStyles.removeBtn, { opacity: pressed ? 0.4 : 1 }]}
      >
        <Ionicons name="close" size={18} color={palette.textDim} />
      </Pressable>
    </Pressable>
  );
}

const queueItemStyles = StyleSheet.create({
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  info: { flex: 1 },
  title: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 18, marginBottom: 3 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 11 },
  removeBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
});

export default function MiniAudioBar() {
  const {
    story,
    isPlaying,
    positionMs,
    durationMs,
    isBarVisible,
    queue,
    togglePlayPause,
    seekTo,
    dismiss,
    removeFromQueue,
    playFromQueue,
    shuffleQueue,
  } = useAudio();

  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const { height: screenHeight } = useWindowDimensions();
  const EXPANDED_HEIGHT = Math.round(screenHeight * 0.72);

  // slideAnim: native driver — controls bar slide in/out from bottom
  const slideAnim = useRef(new Animated.Value(140)).current;
  // expandAnim: JS driver — controls bar height expansion
  const expandAnim = useRef(new Animated.Value(0)).current;
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandedRef = useRef(false);

  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const scrubRef = useRef<number | null>(null);
  const seekHoldRef = useRef<number | null>(null);
  const durationMsRef = useRef(durationMs);
  const seekToRef = useRef(seekTo);

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

  useEffect(() => {
    if (!shouldShow) {
      expandAnim.setValue(0);
      isExpandedRef.current = false;
      setIsExpanded(false);
    }
  }, [shouldShow]);

  function openPanel() {
    isExpandedRef.current = true;
    setIsExpanded(true);
    Animated.spring(expandAnim, {
      toValue: 1,
      useNativeDriver: false,
      tension: 68,
      friction: 12,
    }).start();
  }

  function closePanel() {
    isExpandedRef.current = false;
    Animated.spring(expandAnim, {
      toValue: 0,
      useNativeDriver: false,
      tension: 68,
      friction: 12,
    }).start(() => setIsExpanded(false));
  }

  // Derived animated values (JS driver — tied to expandAnim)
  const panelHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [COLLAPSED_HEIGHT, EXPANDED_HEIGHT],
  });
  const queueOpacity = expandAnim.interpolate({
    inputRange: [0.25, 0.65],
    outputRange: [0, 1],
  });

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const tapSeekGesture = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, success) => {
      if (!success || trackWidthRef.current === 0 || durationMsRef.current === 0) return;
      const p = clamp(e.x / trackWidthRef.current);
      seekHoldRef.current = p;
      seekToRef.current(p * durationMsRef.current).catch(() => undefined);
    });

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

  // Swipe-up on mini bar → expand into full queue panel
  const swipeUpGesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(!isExpanded)
    .activeOffsetY(-8)
    .failOffsetX([-15, 15])
    .onUpdate((e) => {
      if (e.translationY >= 0) return;
      expandAnim.setValue(Math.min(-e.translationY / DRAG_RANGE, 1));
    })
    .onEnd((e) => {
      if (e.translationY < -EXPAND_THRESHOLD || e.velocityY < -500) {
        openPanel();
      } else {
        Animated.spring(expandAnim, { toValue: 0, useNativeDriver: false, tension: 80, friction: 12 }).start();
      }
    })
    .onFinalize(() => {
      if (!isExpandedRef.current) {
        Animated.spring(expandAnim, { toValue: 0, useNativeDriver: false, tension: 80, friction: 12 }).start();
      }
    });

  // Drag pill downward swipe → collapse back to mini bar
  const collapsePanGesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(isExpanded)
    .activeOffsetY(8)
    .onUpdate((e) => {
      if (e.translationY <= 0) return;
      expandAnim.setValue(Math.max(1 - e.translationY / DRAG_RANGE, 0));
    })
    .onEnd((e) => {
      if (e.translationY > EXPAND_THRESHOLD || e.velocityY > 500) {
        closePanel();
      } else {
        Animated.spring(expandAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 12 }).start();
      }
    })
    .onFinalize(() => {
      if (isExpandedRef.current) {
        Animated.spring(expandAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 12 }).start();
      }
    });

  if (!story && !isBarVisible) return null;

  const liveProgress = durationMs > 0 ? positionMs / durationMs : 0;

  if (seekHoldRef.current !== null && durationMs > 0) {
    const targetMs = seekHoldRef.current * durationMs;
    if (Math.abs(positionMs - targetMs) < 1500) seekHoldRef.current = null;
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
    // Outer: position + slide in/out — native driver
    <GestureDetector gesture={swipeUpGesture}>
      <Animated.View
        style={[styles.outerWrapper, { bottom: barBottom, transform: [{ translateY: slideAnim }] }]}
      >
        {/* Inner: height expansion — JS driver */}
        <Animated.View style={[styles.wrapper, { height: panelHeight }]}>

          {/* ── Queue content (hidden when collapsed, revealed on expand) ── */}
          <Animated.View
            style={[styles.queueContent, { opacity: queueOpacity }]}
            pointerEvents={isExpanded ? "auto" : "none"}
          >
            {/* Drag pill — pan down to collapse */}
            <GestureDetector gesture={collapsePanGesture}>
              <View style={styles.dragPillRow}>
                <View style={styles.dragPill} />
              </View>
            </GestureDetector>

            {/* Header */}
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>Queue</Text>
              <Pressable
                onPress={closePanel}
                hitSlop={10}
                style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
              >
                <Ionicons name="close" size={22} color={palette.textMuted} />
              </Pressable>
            </View>

            {/* Now Playing */}
            {story && (
              <View style={styles.queueSection}>
                <Text style={styles.sectionLabel}>NOW PLAYING</Text>
                <View style={styles.nowPlayingRow}>
                  {story.media_url ? (
                    <Image source={{ uri: story.media_url }} style={styles.nowPlayingThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.nowPlayingThumb, { backgroundColor: palette.border }]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nowPlayingTitle} numberOfLines={2}>{story.title}</Text>
                    <Text style={styles.nowPlayingMeta}>{categoryMeta?.label ?? story.category}</Text>
                  </View>
                  <View style={[styles.playingBadge, { backgroundColor: (categoryMeta?.color ?? palette.accent) + "22" }]}>
                    <Ionicons name="musical-notes" size={14} color={categoryMeta?.color ?? palette.accent} />
                  </View>
                </View>
              </View>
            )}

            <View style={styles.divider} />

            {/* Queue list */}
            {queue.length > 0 ? (
              <View style={[styles.queueSection, { flex: 1 }]}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionLabel}>NEXT UP · {queue.length}</Text>
                  <Pressable
                    onPress={shuffleQueue}
                    hitSlop={10}
                    style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                  >
                    <Ionicons name="shuffle" size={18} color={palette.textDim} />
                  </Pressable>
                </View>
                <FlatList
                  data={queue}
                  keyExtractor={(item, idx) => `${item.id}-${idx}`}
                  renderItem={({ item, index }) => (
                    <QueueItem
                      story={item}
                      palette={palette}
                      onPlay={() => { playFromQueue(index); closePanel(); }}
                      onRemove={() => removeFromQueue(index)}
                    />
                  )}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ gap: 4, paddingBottom: 8 }}
                />
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="list-outline" size={32} color={palette.textDim} />
                <Text style={styles.emptyTitle}>Queue is empty</Text>
                <Text style={styles.emptySubtext}>Swipe right on a story to add it</Text>
              </View>
            )}
          </Animated.View>

          {/* ── Mini bar row (always pinned at bottom) ── */}
          <Pressable
            onPress={!isExpanded ? openPanel : undefined}
            style={({ pressed }) => [
              styles.inner,
              { opacity: pressed && !isExpanded ? 0.88 : 1 },
            ]}
          >
            <View style={styles.waveContainer} pointerEvents="none">
              <WaveBar delay={0}   isPlaying={isPlaying} color={palette.accent} />
              <WaveBar delay={80}  isPlaying={isPlaying} color={palette.accent} />
              <WaveBar delay={160} isPlaying={isPlaying} color={palette.accent} />
              <WaveBar delay={40}  isPlaying={isPlaying} color={palette.accent} />
            </View>
            <View style={styles.info}>
              <Text style={styles.titleText} numberOfLines={1}>{story?.title ?? ""}</Text>
              <Text style={styles.timeText}>
                {durationMs > 0
                  ? `${formatMs(displayMs)} / ${formatMs(durationMs)}`
                  : categoryMeta?.label ?? ""}
              </Text>
            </View>
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
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); dismiss(); }}
              hitSlop={12}
              style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Ionicons name="close" size={16} color={palette.textDim} />
            </Pressable>
          </Pressable>

          {/* ── Progress bar (always at bottom) ── */}
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
      </Animated.View>
    </GestureDetector>
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
    outerWrapper: {
      position: "absolute",
      left: 10,
      right: 10,
    },
    wrapper: {
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
    // ── Queue content ──
    queueContent: {
      flex: 1,
      overflow: "hidden",
    },
    dragPillRow: {
      alignItems: "center",
      paddingTop: 12,
      paddingBottom: 4,
    },
    dragPill: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: palette.border,
    },
    queueHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 16,
    },
    queueTitle: {
      fontFamily: "Inter_700Bold",
      fontSize: 20,
      color: palette.text,
    },
    queueSection: {
      paddingHorizontal: 20,
    },
    sectionLabel: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 11,
      color: palette.textDim,
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    nowPlayingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 4,
    },
    nowPlayingThumb: {
      width: 52,
      height: 52,
      borderRadius: 10,
    },
    nowPlayingTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: palette.text,
      lineHeight: 20,
      marginBottom: 3,
    },
    nowPlayingMeta: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: palette.textDim,
    },
    playingBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    divider: {
      height: 1,
      backgroundColor: palette.border,
      marginHorizontal: 20,
      marginVertical: 16,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 32,
      gap: 8,
    },
    emptyTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: palette.textMuted,
    },
    emptySubtext: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: palette.textDim,
      textAlign: "center",
    },
    // ── Mini bar row ──
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
    // ── Progress bar ──
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
