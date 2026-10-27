import { memo, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import CategoryBadge from "@/components/CategoryBadge";
import SaveButton from "@/components/SaveButton";
import StoryImage from "@/components/StoryImage";
import { useAudio } from "@/contexts/AudioContext";
import { useAuth } from "@/contexts/AuthContext";
import { canSaveStories } from "@/constants/features";
import { useNavChromeActions } from "@/contexts/NavChromeContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useShowToast } from "@/contexts/ToastContext";
import { formatRelativeTime, isToday } from "@/utils/time";
import { sourceDomain } from "@/utils/url";
import type { Story } from "@workspace/api-client-react";
import type { ThemeColors } from "@/constants/theme";

/** Drag distance at which a swipe arms its action. */
const SWIPE_AT = 96;
const TILT_DEG = 6;
const PLAY_GREEN = "#22C55E";
const QUEUE_AMBER = "#F59E0B";
/** Snap-back after a swipe: settles with one small overshoot rather than a wobble. */
const RETURN_SPRING = { stiffness: 260, damping: 30 };

type SwipeKind = "play" | "queue" | "playing" | "save" | "unsave";

const ACTIONS: Record<SwipeKind, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  play: { label: "Play", icon: "play" },
  queue: { label: "Queue", icon: "add" },
  playing: { label: "Playing", icon: "pulse" },
  save: { label: "Save", icon: "bookmark" },
  unsave: { label: "Unsave", icon: "bookmark-outline" },
};

/** Extract ticker symbol from stock_note like "AAPL (Apple Inc.)" */
function parseTickerFromStockNote(stockNote?: string | null): string | null {
  if (!stockNote) return null;
  const match = stockNote.match(/^([A-Z]{1,5})\b/);
  return match ? match[1] : null;
}

interface StoryCardProps {
  story: Story;
  /** "list" is the mobile feed; "grid" and "feature" are the desktop grid cells. */
  variant?: "list" | "grid" | "feature";
}

export function StoryCard({ story, variant = "list" }: StoryCardProps) {
  const desktop = variant !== "list";
  const feature = variant === "feature";
  const { toggleSaved, isSaved } = useSavedStories();
  const { user } = useAuth();
  const canSave = canSaveStories(!!user);
  const { story: current, isPlaying, playStory, togglePlayPause, isBarVisible, addToQueue, removeFromQueue, queue } =
    useAudio();
  const { setQueueOpen } = useNavChromeActions();
  const showToast = useShowToast();
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const ticker = parseTickerFromStockNote(story.stock_note);
  const displaySource = sourceDomain(story.source_url);
  const timestamp = story.published_at ?? null;
  const saved = isSaved(story.id);
  const isCurrent = current?.id === story.id;

  // Swipe state: tx drives everything on the UI thread; dir/armed mirror it
  // into React for the colours and icons.
  const tx = useSharedValue(0);
  const fromTop = useSharedValue(1);
  const cardH = useSharedValue(1);
  const pop = useSharedValue(1);
  const hover = useSharedValue(0);
  const [hovered, setHovered] = useState(false);
  const [dir, setDir] = useState(0);
  const [armed, setArmed] = useState(false);

  const kind: SwipeKind =
    dir >= 0
      ? isCurrent && isPlaying
        ? "playing"
        : isBarVisible
          ? "queue"
          : "play"
      : saved
        ? "unsave"
        : "save";
  const action = ACTIONS[kind];
  const color =
    kind === "queue"
      ? QUEUE_AMBER
      : kind === "save"
        ? palette.accent
        : kind === "unsave"
          ? "#64748B"
          : PLAY_GREEN;

  const onArm = (isArmed: boolean) => {
    setArmed(isArmed);
    if (isArmed) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  };

  useAnimatedReaction(
    () => Math.sign(tx.value),
    (d, prev) => {
      if (d !== 0 && d !== prev) runOnJS(setDir)(d);
    },
  );
  useAnimatedReaction(
    () => Math.abs(tx.value) >= SWIPE_AT - 0.5,
    (isArmed, prev) => {
      if (isArmed === prev) return;
      if (isArmed) pop.value = withSequence(withTiming(0.82, { duration: 140 }), withSpring(1, { stiffness: 400, damping: 30 }));
      runOnJS(onArm)(isArmed);
    },
  );

  const handleSave = () => {
    if (!canSave) return;
    toggleSaved(story).catch(() => undefined);
    showToast(
      saved
        ? { text: "Removed from Saved", color: "#64748B" }
        : { text: "Saved", color: palette.accent },
    );
  };

  const handleSwipePlay = () => {
    if (isCurrent && isPlaying) {
      showToast({ text: "Already playing", color: PLAY_GREEN });
      return;
    }
    if (isBarVisible && !isCurrent) {
      if (queue.some((q) => q.id === story.id)) {
        showToast({ text: "Already in queue", color: QUEUE_AMBER });
        return;
      }
      addToQueue(story);
      showToast({
        text: `Added to queue · ${queue.length + 1}`,
        color: QUEUE_AMBER,
        action: { label: "View", onPress: () => setQueueOpen(true) },
      });
      return;
    }
    playStory(story).catch(() => undefined);
    showToast({ text: "Playing now", color: PLAY_GREEN });
  };

  const queueIndex = queue.findIndex((q) => q.id === story.id);
  const queued = queueIndex >= 0;

  // Desktop "+" button: toggles the story in the queue whether or not
  // anything is playing yet.
  const handleQueueButton = () => {
    if (queued) {
      removeFromQueue(queueIndex);
      showToast({ text: "Removed from queue", color: "#64748B" });
      return;
    }
    addToQueue(story);
    showToast({
      text: `Added to queue · ${queue.length + 1}`,
      color: QUEUE_AMBER,
      action: { label: "View", onPress: () => setQueueOpen(true) },
    });
  };

  const onHover = (isIn: boolean) => {
    setHovered(isIn);
    hover.value = withTiming(isIn ? 1 : 0, { duration: 220 });
  };

  const onSwipe = (direction: number) => {
    if (direction > 0) handleSwipePlay();
    else handleSave();
  };

  const swipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onBegin((e) => {
      fromTop.value = e.y < cardH.value / 2 ? 1 : -1;
    })
    .onUpdate((e) => {
      let x = e.translationX;
      if (!canSave) x = Math.max(0, x);
      const a = Math.abs(x);
      tx.value = a > SWIPE_AT ? Math.sign(x) * (SWIPE_AT + (a - SWIPE_AT) * 0.45) : x;
    })
    .onEnd((e) => {
      const d = Math.sign(tx.value);
      const commit =
        Math.abs(tx.value) >= SWIPE_AT ||
        (Math.abs(e.velocityX) > 900 && Math.abs(tx.value) > 40 && Math.sign(e.velocityX) === d);
      if (commit) {
        // Fling a little further, fire the action, then spring home.
        tx.value = withTiming(d * 190, { duration: 150 }, (done) => {
          if (!done) return;
          runOnJS(onSwipe)(d);
          tx.value = withSpring(0, RETURN_SPRING);
        });
      } else {
        tx.value = withSpring(0, RETURN_SPRING);
      }
    });

  const cardStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(tx.value) / SWIPE_AT);
    const rot = Math.max(
      -TILT_DEG * 1.4,
      Math.min(TILT_DEG * 1.4, (tx.value / SWIPE_AT) * TILT_DEG * fromTop.value),
    );
    return {
      transformOrigin: fromTop.value > 0 ? "50% 115%" : "50% -15%",
      transform: [{ translateX: tx.value }, { rotate: `${rot}deg` }, { scale: 1 + p * 0.015 }],
      shadowOpacity: Math.max(p * 0.55, hover.value * 0.35),
      shadowRadius: Math.max(p * 22, hover.value * 17),
    };
  });

  const bgStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(tx.value) / SWIPE_AT);
    const isArmed = Math.abs(tx.value) >= SWIPE_AT - 0.5;
    return { opacity: tx.value === 0 ? 0 : isArmed ? 1 : 0.35 + p * 0.4 };
  });

  const badgeStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(tx.value) / SWIPE_AT);
    return { opacity: p, transform: [{ scale: interpolate(p, [0, 1], [0.55, 1]) * pop.value }] };
  });

  const stampStyle = useAnimatedStyle(() => {
    const o = Math.max(0, Math.min(1, (Math.abs(tx.value) - 24) / (SWIPE_AT - 24)));
    return {
      opacity: o,
      transform: [
        { rotate: tx.value > 0 ? "-14deg" : "14deg" },
        { scale: interpolate(o, [0, 1], [1.3, 1]) },
      ],
    };
  });

  const handlePlayButton = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (desktop) {
      // Desktop plays in place — the player bar is always in view.
      if (isCurrent) togglePlayPause().catch(() => undefined);
      else playStory(story).catch(() => undefined);
      return;
    }
    playStory(story).catch(() => undefined);
    router.push({ pathname: "/story/[id]", params: { id: story.id } });
  };

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    router.push({ pathname: "/story/[id]", params: { id: story.id } });
  };

  const cardBody = (
    <Animated.View
      style={[styles.card, hovered && styles.cardHovered, cardStyle]}
      onLayout={(e) => {
        cardH.value = e.nativeEvent.layout.height;
      }}
    >
      <Pressable
        onPress={onPress}
        onHoverIn={() => onHover(true)}
        onHoverOut={() => onHover(false)}
        style={({ pressed }) => [feature && styles.featureRow, { opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={feature ? styles.featureMediaWrap : undefined}>
          <StoryImage
            uri={story.media_url}
            category={story.category}
            style={[styles.media, feature && styles.featureMedia]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.stamp,
              { borderColor: color, [dir >= 0 ? "left" : "right"]: 18 },
              stampStyle,
            ]}
          >
            <Text style={[styles.stampText, { color }]}>{action.label.toUpperCase()}</Text>
          </Animated.View>
        </View>

        <View style={[styles.body, feature && styles.featureBody]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Pressable
                onPress={handlePlayButton}
                hitSlop={6}
                accessibilityLabel={desktop && isCurrent && isPlaying ? "Pause story" : "Play story"}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons
                  name={desktop && isCurrent && isPlaying ? "pause-circle" : "play-circle"}
                  size={22}
                  color="#22C55E"
                />
              </Pressable>
              <CategoryBadge category={story.category} />
            </View>
            <View style={styles.actions}>
              {ticker ? (
                <View style={styles.tickerPill}>
                  <Text style={styles.tickerText}>${ticker}</Text>
                </View>
              ) : null}
              {desktop && !(isCurrent && isPlaying) ? (
                <Pressable
                  onPress={handleQueueButton}
                  onHoverIn={() => onHover(true)}
                  style={({ hovered: btnHovered }) => [
                    styles.queueBtn,
                    { opacity: hovered || queued ? 1 : 0 },
                    btnHovered && { backgroundColor: palette.text + "12" },
                  ]}
                  accessibilityLabel={queued ? "Remove from queue" : "Add to queue"}
                >
                  <Ionicons name="add" size={20} color={queued ? QUEUE_AMBER : palette.textDim} />
                </Pressable>
              ) : null}
              {canSave ? <SaveButton story={story} /> : null}
            </View>
          </View>

          <Text style={[styles.title, feature && styles.featureTitle]} numberOfLines={feature ? 4 : 3}>
            {story.title}
          </Text>

          <Text style={[styles.insight, feature && styles.featureInsight]} numberOfLines={feature ? 3 : 2}>
            {story.one_liner}
          </Text>

          <View style={styles.footer}>
            <Text style={styles.source} numberOfLines={1}>
              {displaySource}
            </Text>
            <View style={styles.footerRight}>
              {isToday(timestamp) ? (
                <View style={styles.todayBadge}>
                  <Text style={styles.todayBadgeText}>Today</Text>
                </View>
              ) : null}
              {timestamp ? (
                <Text style={styles.timestamp}>
                  {formatRelativeTime(timestamp)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );

  return (
    <View style={desktop ? styles.gridContainer : styles.swipeContainer}>
      <Animated.View
        style={[
          styles.actionBg,
          { backgroundColor: color, justifyContent: dir >= 0 ? "flex-start" : "flex-end" },
          bgStyle,
        ]}
      >
        <Animated.View style={[styles.actionBadge, badgeStyle]}>
          <View
            style={[
              styles.actionCircle,
              { backgroundColor: armed ? "#fff" : "rgba(255,255,255,0.25)" },
            ]}
          >
            <Ionicons name={action.icon} size={22} color={armed ? color : "#fff"} />
          </View>
          <Text style={styles.actionLabel}>{action.label}</Text>
        </Animated.View>
      </Animated.View>

      {Platform.OS === "web" ? cardBody : <GestureDetector gesture={swipe}>{cardBody}</GestureDetector>}
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    swipeContainer: {
      marginHorizontal: 16,
      marginBottom: 14,
    },
    gridContainer: {
      flex: 1,
    },
    cardHovered: {
      borderColor: palette.borderStrong,
    },
    featureRow: {
      flexDirection: "row",
    },
    featureMediaWrap: {
      flex: 1.15,
    },
    featureMedia: {
      height: "100%",
      minHeight: 300,
    },
    featureBody: {
      flex: 1,
      paddingVertical: 26,
      paddingHorizontal: 28,
      justifyContent: "center",
      gap: 14,
    },
    featureTitle: {
      fontSize: 28,
      lineHeight: 33,
    },
    featureInsight: {
      fontSize: 16,
      lineHeight: 23,
    },
    queueBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    actionBg: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 18,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 26,
    },
    actionBadge: {
      alignItems: "center",
      gap: 8,
    },
    actionCircle: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    actionLabel: {
      fontFamily: "Inter_700Bold",
      fontSize: 12,
      letterSpacing: 0.5,
      color: "#fff",
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: 18,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: palette.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0,
    },
    stamp: {
      position: "absolute",
      top: 18,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderWidth: 3,
      borderRadius: 10,
      backgroundColor: "rgba(10,14,21,0.55)",
    },
    stampText: {
      fontFamily: "Inter_700Bold",
      fontSize: 22,
      letterSpacing: 1.8,
    },
    media: {
      width: "100%",
      height: 180,
      backgroundColor: palette.surfaceHigh,
    },
    body: {
      padding: 16,
      gap: 10,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    rowLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    tickerPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: palette.accent + "1F",
      borderWidth: 1,
      borderColor: palette.accent + "55",
    },
    tickerText: {
      fontFamily: "Inter_700Bold",
      fontSize: 12,
      color: palette.accent,
      letterSpacing: 0.4,
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 18,
      lineHeight: 24,
      color: palette.text,
    },
    insight: {
      fontFamily: "Inter_500Medium",
      fontSize: 14,
      lineHeight: 20,
      color: palette.textMuted,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 4,
    },
    source: {
      fontFamily: "Inter_500Medium",
      fontSize: 12,
      color: palette.textDim,
      flex: 1,
    },
    footerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    todayBadge: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: "#22C55E22",
      borderWidth: 1,
      borderColor: "#22C55E55",
    },
    todayBadgeText: {
      fontFamily: "Inter_700Bold",
      fontSize: 10,
      color: "#22C55E",
      letterSpacing: 0.3,
    },
    timestamp: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: palette.textDim,
    },
  });
}

// Memoized: the feed parent re-renders on refresh/search state, and
// re-rendering every visible card per scroll-adjacent state change is
// what drops frames mid-fling. Context updates (saved/audio state) still
// flow through; only identical story/variant props skip a re-render.
export default memo(StoryCard);
