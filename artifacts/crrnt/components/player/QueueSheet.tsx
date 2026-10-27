import { useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useAudio } from "@/contexts/AudioContext";
import { useNavChrome } from "@/contexts/NavChromeContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { getCategoryMeta } from "@/constants/categories";
import type { ThemeColors } from "@/constants/theme";
import StoryImage from "@/components/StoryImage";
import WaveBars from "@/components/player/WaveBars";
import { DESKTOP } from "@/hooks/useLayoutMode";
import { formatTime } from "@/utils/formatTime";
import type { Story } from "@workspace/api-client-react";

const ROW_H = 76;
const REMOVE_AT = 80;
const SHEET_SPRING = { stiffness: 260, damping: 32 };

interface Reorder {
  key: string;
  from: number;
  dy: number;
}

function QueueRow({
  story,
  rowKey,
  index,
  reorder,
  target,
  settle,
  styles,
  theme,
  onGrip,
  onRemove,
  onPlay,
  hoverRemove,
}: {
  story: Story;
  rowKey: string;
  index: number;
  reorder: Reorder | null;
  target: number | null;
  settle: { key: string; offset: number } | null;
  styles: ReturnType<typeof createStyles>;
  theme: ThemeColors;
  onGrip: (phase: "start" | "move" | "end", dy: number, index: number, key: string) => void;
  onRemove: () => void;
  onPlay: () => void;
  /** Desktop: show a remove button on hover alongside swipe-to-remove. */
  hoverRemove: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = getCategoryMeta(story.category);
  const me = reorder?.key === rowKey;
  const tx = useSharedValue(0);
  const offset = useSharedValue(0);
  const height = useSharedValue(ROW_H);

  // Rows between the dragged row's origin and its target slide out of the way.
  let shift = 0;
  if (reorder && !me && target !== null) {
    if (reorder.from < target && index > reorder.from && index <= target) shift = -ROW_H;
    if (reorder.from > target && index < reorder.from && index >= target) shift = ROW_H;
  }

  useEffect(() => {
    if (me && reorder) offset.value = reorder.dy;
    else if (reorder) offset.value = withTiming(shift, { duration: 200 });
    else if (settle?.key === rowKey) {
      // Dropped: the list has already reordered, so ease the remainder out.
      offset.value = settle.offset;
      offset.value = withSpring(0, { stiffness: 300, damping: 35 });
    } else offset.value = 0;
  }, [me, reorder, shift, settle, rowKey, offset]);

  const swipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      const x = Math.min(0, e.translationX);
      tx.value = x < -90 ? -90 + (x + 90) * 0.4 : x;
    })
    .onEnd(() => {
      if (tx.value <= -REMOVE_AT) {
        tx.value = withTiming(-480, { duration: 220 });
        height.value = withTiming(0, { duration: 240 }, (done) => {
          if (done) runOnJS(onRemove)();
        });
      } else {
        tx.value = withSpring(0, { stiffness: 260, damping: 32 });
      }
    });

  const grip = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onStart(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      onGrip("start", 0, index, rowKey);
    })
    .onUpdate((e) => onGrip("move", e.translationY, index, rowKey))
    .onFinalize((e) => onGrip("end", e.translationY, index, rowKey));

  const removeNow = () => {
    tx.value = withTiming(-480, { duration: 220 });
    height.value = withTiming(0, { duration: 240 }, (done) => {
      if (done) runOnJS(onRemove)();
    });
  };

  const wrapStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: height.value / ROW_H,
    transform: [{ translateY: offset.value }],
  }));
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { scale: me ? 1.03 : 1 }],
  }));
  const removeStyle = useAnimatedStyle(() => {
    const p = Math.min(1, -tx.value / REMOVE_AT);
    return { opacity: tx.value ? 0.4 + p * 0.6 : 0 };
  });

  return (
    <Animated.View style={[{ zIndex: me ? 3 : 1 }, wrapStyle]}>
      <Animated.View style={[styles.removeBg, removeStyle]}>
        <Ionicons name="close" size={18} color="#fff" />
        <Text style={styles.removeText}>Remove</Text>
      </Animated.View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.row, me && styles.rowLifted, rowStyle]}>
          <Pressable
            style={styles.rowMain}
            onPress={onPlay}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
          >
            <StoryImage uri={story.media_url} category={story.category} style={styles.thumb} />
            <View style={styles.tx}>
              <Text style={styles.t1} numberOfLines={2}>
                {story.title}
              </Text>
              <View style={styles.t2}>
                <View style={[styles.dot, { backgroundColor: meta?.color ?? theme.accent }]} />
                <Text style={styles.t2Text}>{meta?.label ?? story.category}</Text>
              </View>
            </View>
          </Pressable>
          {hoverRemove ? (
            <Pressable
              onPress={removeNow}
              onHoverIn={() => setHovered(true)}
              onHoverOut={() => setHovered(false)}
              style={[styles.hoverRemove, { opacity: hovered ? 1 : 0 }]}
              accessibilityLabel="Remove from queue"
            >
              <Ionicons name="close" size={18} color={theme.textDim} />
            </Pressable>
          ) : null}
          <GestureDetector gesture={grip}>
            <View style={styles.grip} accessibilityLabel="Drag to reorder">
              <Ionicons name="reorder-three" size={24} color={theme.textDim} />
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

/** Now playing + the reorderable "up next" list, shared by the sheet and the desktop panel. */
function QueueBody({
  styles,
  bottomPad,
  desktop,
  onPlayed,
}: {
  styles: ReturnType<typeof createStyles>;
  bottomPad: number;
  desktop: boolean;
  onPlayed: () => void;
}) {
  const { story, isPlaying, positionMs, durationMs, queue, togglePlayPause, removeFromQueue, moveInQueue, playFromQueue } =
    useAudio();
  const { theme } = useThemeContext();
  const [reorder, setReorder] = useState<Reorder | null>(null);
  const [settle, setSettle] = useState<{ key: string; offset: number } | null>(null);

  // Stable keys that survive reordering, even if a story is queued twice.
  const keys = useMemo(() => {
    const seen = new Map<string, number>();
    return queue.map((s) => {
      const n = seen.get(s.id) ?? 0;
      seen.set(s.id, n + 1);
      return `${s.id}#${n}`;
    });
  }, [queue]);

  const target =
    reorder !== null
      ? Math.max(0, Math.min(queue.length - 1, Math.round(reorder.from + reorder.dy / ROW_H)))
      : null;

  const onGrip = (phase: "start" | "move" | "end", dy: number, index: number, key: string) => {
    if (phase === "start") {
      setSettle(null);
      setReorder({ key, from: index, dy: 0 });
      return;
    }
    if (!reorder) return;
    if (phase === "move") {
      setReorder({ ...reorder, dy });
      return;
    }
    const to = Math.max(0, Math.min(queue.length - 1, Math.round(reorder.from + dy / ROW_H)));
    setReorder(null);
    setSettle({ key: reorder.key, offset: dy - (to - reorder.from) * ROW_H });
    if (to !== reorder.from) {
      Haptics.selectionAsync().catch(() => undefined);
      moveInQueue(reorder.from, to);
    }
  };

  const progress = durationMs > 0 ? Math.min(positionMs / durationMs, 1) : 0;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: desktop ? 14 : 16, paddingBottom: bottomPad }}
      scrollEnabled={reorder === null}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.label}>NOW PLAYING</Text>
      {story ? (
        <View style={[styles.now, { borderColor: theme.accent + "40", backgroundColor: theme.accent + "14" }]}>
          <View style={styles.nowThumb}>
            <StoryImage uri={story.media_url} category={story.category} style={StyleSheet.absoluteFill} />
            <View style={styles.nowScrim}>
              <WaveBars isPlaying={isPlaying} color="#fff" />
            </View>
          </View>
          <View style={styles.tx}>
            <Text style={styles.t1} numberOfLines={1}>
              {story.title}
            </Text>
            <View style={styles.nowProgressRow}>
              <View style={styles.nowRail}>
                <View style={[styles.nowFill, { width: `${progress * 100}%` }]} />
              </View>
              <Text style={styles.nowTime}>{formatTime(positionMs)}</Text>
            </View>
          </View>
          <Pressable
            style={styles.nowPlay}
            onPress={togglePlayPause}
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
          >
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={15}
              color={theme.bg}
              style={isPlaying ? undefined : { marginLeft: 2 }}
            />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.labelRow}>
        <Text style={styles.label}>UP NEXT</Text>
        {queue.length > 1 ? <Text style={[styles.label, styles.labelHint]}>DRAG TO REORDER</Text> : null}
      </View>

      {queue.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="add" size={24} color={theme.warning} />
          </View>
          <Text style={styles.emptyTitle}>Nothing up next</Text>
          <Text style={styles.emptyText}>
            {desktop
              ? "While a story plays, swipe right on another — or hit + on a card — to add it here."
              : "While a story plays, swipe right on another to add it here."}
          </Text>
        </View>
      ) : (
        queue.map((s, i) => (
          <QueueRow
            key={keys[i]}
            rowKey={keys[i]}
            story={s}
            index={i}
            reorder={reorder}
            target={target}
            settle={settle}
            styles={styles}
            theme={theme}
            onGrip={onGrip}
            hoverRemove={desktop}
            onRemove={() => removeFromQueue(i)}
            onPlay={() => {
              playFromQueue(i).catch(() => undefined);
              onPlayed();
            }}
          />
        ))
      )}
    </ScrollView>
  );
}

function QueueSummary({ styles }: { styles: ReturnType<typeof createStyles> }) {
  const { positionMs, durationMs, queue } = useAudio();
  const remainingMs = Math.max(0, durationMs - positionMs);
  return (
    <Text style={styles.subtitle}>
      {queue.length} up next
      {durationMs > 0 ? ` · ${formatTime(remainingMs)} left in this story` : ""}
    </Text>
  );
}

/** Mobile: a bottom sheet over the player, dragged down by its header to close. */
export default function QueueSheet() {
  const { queue, clearQueue } = useAudio();
  const { isQueueOpen, setQueueOpen } = useNavChrome();
  const { theme } = useThemeContext();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const sheetH = H - insets.top - 40;

  const sheetY = useSharedValue(sheetH + 40);

  useEffect(() => {
    sheetY.value = withSpring(isQueueOpen ? 0 : sheetH + 40, SHEET_SPRING);
  }, [isQueueOpen, sheetH, sheetY]);

  useEffect(() => {
    if (!isQueueOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setQueueOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [isQueueOpen, setQueueOpen]);

  const close = () => setQueueOpen(false);

  const dismissPan = Gesture.Pan()
    .activeOffsetY(6)
    .onUpdate((e) => {
      sheetY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 800) {
        sheetY.value = withSpring(sheetH + 40, SHEET_SPRING);
        runOnJS(setQueueOpen)(false);
      } else {
        sheetY.value = withSpring(0, SHEET_SPRING);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const dimStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * Math.max(0, 1 - sheetY.value / sheetH),
  }));

  return (
    <>
      <Animated.View
        style={[styles.dim, dimStyle]}
        pointerEvents={isQueueOpen ? "auto" : "none"}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close queue" />
      </Animated.View>

      <Animated.View
        style={[styles.sheet, { height: sheetH }, sheetStyle]}
        pointerEvents={isQueueOpen ? "auto" : "none"}
      >
        <GestureDetector gesture={dismissPan}>
          <View style={styles.head}>
            <View style={styles.grab} />
            <View style={styles.headRow}>
              <View>
                <Text style={styles.title}>Queue</Text>
                <QueueSummary styles={styles} />
              </View>
              {queue.length > 0 ? (
                <Pressable style={styles.pillBtn} onPress={clearQueue}>
                  <Text style={styles.pillText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </GestureDetector>

        <QueueBody styles={styles} bottomPad={insets.bottom + 40} desktop={false} onPlayed={close} />
      </Animated.View>
    </>
  );
}

/** Desktop: a panel that slides in from the right; the app makes room for it. */
export function QueuePanel() {
  const { queue, clearQueue } = useAudio();
  const { isQueueOpen, setQueueOpen, queue: queueAnim } = useNavChrome();
  const { theme } = useThemeContext();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - queueAnim.value) * (DESKTOP.queueW + 40) }],
    opacity: queueAnim.value < 0.005 ? 0 : 1,
  }));

  return (
    <Animated.View
      style={[styles.panel, panelStyle]}
      pointerEvents={isQueueOpen ? "auto" : "none"}
    >
      <View style={styles.panelHead}>
        <View>
          <Text style={[styles.title, { fontSize: 24 }]}>Queue</Text>
          <QueueSummary styles={styles} />
        </View>
        <View style={styles.panelActions}>
          {queue.length > 0 ? (
            <Pressable style={styles.pillBtn} onPress={clearQueue}>
              <Text style={styles.pillText}>Clear</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.panelClose}
            onPress={() => setQueueOpen(false)}
            accessibilityLabel="Close queue"
          >
            <Ionicons name="close" size={18} color={theme.textMuted} />
          </Pressable>
        </View>
      </View>
      <QueueBody styles={styles} bottomPad={30} desktop onPlayed={() => undefined} />
    </Animated.View>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000", zIndex: 44 },
    sheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 45,
      backgroundColor: theme.bgElevated,
      borderTopLeftRadius: 34,
      borderTopRightRadius: 34,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.borderStrong,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -20 },
      shadowOpacity: 0.5,
      shadowRadius: 40,
      elevation: 24,
    },
    head: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 6 },
    grab: {
      width: 38,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.text + "38",
      alignSelf: "center",
      marginBottom: 18,
    },
    headRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
    title: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.3, color: theme.text },
    subtitle: {
      fontFamily: "Inter_400Regular",
      fontSize: 13.5,
      color: theme.textMuted,
      marginTop: 2,
      fontVariant: ["tabular-nums"],
    },
    pillBtn: {
      height: 32,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: theme.text + "12",
      justifyContent: "center",
    },
    pillText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: theme.textMuted },
    labelRow: { flexDirection: "row", justifyContent: "space-between" },
    label: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 10.5,
      letterSpacing: 1.5,
      color: theme.textMuted,
      paddingTop: 18,
      paddingBottom: 10,
      paddingHorizontal: 6,
    },
    labelHint: { color: theme.textDim, letterSpacing: 1 },
    now: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 10,
      borderRadius: 18,
      borderWidth: 1,
    },
    nowThumb: { width: 48, height: 48, borderRadius: 11, overflow: "hidden" },
    nowScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    nowProgressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
    nowRail: { flex: 1, height: 3, borderRadius: 2, backgroundColor: theme.text + "1F" },
    nowFill: { height: "100%", borderRadius: 2, backgroundColor: theme.accent },
    nowTime: {
      fontFamily: "Inter_500Medium",
      fontSize: 11.5,
      color: theme.textMuted,
      fontVariant: ["tabular-nums"],
    },
    nowPlay: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.text,
      alignItems: "center",
      justifyContent: "center",
    },
    removeBg: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      height: ROW_H - 8,
      borderRadius: 16,
      backgroundColor: theme.negative,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 6,
      paddingRight: 22,
    },
    removeText: { fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff" },
    row: {
      height: ROW_H - 8,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 10,
      borderRadius: 16,
      backgroundColor: theme.surface,
    },
    rowLifted: {
      backgroundColor: theme.surfaceHigh,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.5,
      shadowRadius: 24,
      elevation: 12,
    },
    rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "stretch" },
    thumb: { width: 48, height: 48, borderRadius: 11 },
    tx: { flex: 1, minWidth: 0 },
    t1: { fontFamily: "Inter_600SemiBold", fontSize: 14.5, lineHeight: 18, color: theme.text },
    t2: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
    t2Text: { fontFamily: "Inter_400Regular", fontSize: 12, color: theme.textDim },
    dot: { width: 6, height: 6, borderRadius: 3 },
    grip: { width: 44, height: 52, alignItems: "center", justifyContent: "center" },
    hoverRemove: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
    panel: {
      position: "absolute",
      top: 14,
      right: 14,
      bottom: 14,
      width: DESKTOP.queueW,
      zIndex: 40,
      backgroundColor: theme.bgElevated,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 26,
      shadowColor: "#000",
      shadowOffset: { width: -20, height: 0 },
      shadowOpacity: 0.45,
      shadowRadius: 60,
    },
    panelHead: {
      paddingHorizontal: 22,
      paddingTop: 22,
      paddingBottom: 8,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    panelActions: { flexDirection: "row", gap: 6, alignItems: "center" },
    panelClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.text + "0F",
      alignItems: "center",
      justifyContent: "center",
    },
    empty: {
      alignItems: "center",
      gap: 8,
      paddingVertical: 26,
      paddingHorizontal: 30,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.border,
      borderRadius: 18,
    },
    emptyIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: theme.warning + "24",
      alignItems: "center",
      justifyContent: "center",
    },
    emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: theme.text, marginTop: 4 },
    emptyText: {
      fontFamily: "Inter_400Regular",
      fontSize: 13.5,
      lineHeight: 19,
      color: theme.textMuted,
      textAlign: "center",
    },
  });
}
