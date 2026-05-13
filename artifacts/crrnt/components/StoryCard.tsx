import { useMemo, useRef } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import CategoryBadge from "@/components/CategoryBadge";
import SaveButton from "@/components/SaveButton";
import { useAudio } from "@/contexts/AudioContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePurchases } from "@/contexts/PurchasesContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { formatRelativeTime, isToday } from "@/utils/time";
import type { Story } from "@workspace/api-client-react";
import type { ThemeColors } from "@/constants/theme";

const ACTION_WIDTH = 80;

/** Extract ticker symbol from stock_note like "AAPL (Apple Inc.)" */
function parseTickerFromStockNote(stockNote?: string | null): string | null {
  if (!stockNote) return null;
  const match = stockNote.match(/^([A-Z]{1,5})\b/);
  return match ? match[1] : null;
}

/** Extract a display-friendly domain from a URL */
function sourceDomain(url?: string | null): string {
  if (!url) return "CRRNT";
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "");
  } catch {
    return "CRRNT";
  }
}

function PlayAction({ isQueue }: { isQueue: boolean }) {
  return (
    <View style={[actionStyles.playAction, isQueue && actionStyles.queueAction]}>
      <Ionicons
        name={isQueue ? "add-circle" : "play-circle"}
        size={36}
        color="#fff"
      />
    </View>
  );
}

function SaveAction({ accent }: { accent: string }) {
  return (
    <View style={[actionStyles.saveAction, { backgroundColor: accent }]}>
      <Ionicons name="bookmark" size={28} color="#fff" />
    </View>
  );
}

const actionStyles = StyleSheet.create({
  playAction: {
    width: ACTION_WIDTH,
    backgroundColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
  },
  queueAction: {
    backgroundColor: "#F59E0B",
  },
  saveAction: {
    width: ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
});

interface StoryCardProps {
  story: Story;
}

export function StoryCard({ story }: StoryCardProps) {
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const { toggleSaved } = useSavedStories();
  const { user } = useAuth();
  const { playStory, isBarVisible, addToQueue } = useAudio();
  const { isPro } = usePurchases();
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const ticker = parseTickerFromStockNote(story.stock_note);
  const displaySource = sourceDomain(story.source_url);
  const timestamp = story.published_at ?? null;

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (!user) {
      Alert.alert(
        "Create a free account",
        "Sign up to save stories and pick up where you left off.",
        [
          { text: "Sign in", onPress: () => router.push("/auth/login" as any) },
          { text: "Create account", onPress: () => router.push("/auth/register" as any) },
          { text: "Not now", style: "cancel" },
        ]
      );
      return;
    }
    toggleSaved(story).catch(() => undefined);
  };

  const handleSwipePlay = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (isBarVisible) {
      addToQueue(story);
    } else {
      playStory(story).catch(() => undefined);
    }
  };

  const handlePlayButton = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    playStory(story).catch(() => undefined);
    router.push({ pathname: "/story/[id]", params: { id: story.id } });
  };

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    router.push({ pathname: "/story/[id]", params: { id: story.id } });
  };

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      containerStyle={styles.swipeContainer}
      childrenContainerStyle={styles.card}
      renderLeftActions={isPro ? () => <PlayAction isQueue={isBarVisible} /> : undefined}
      renderRightActions={() => <SaveAction accent={palette.accent} />}
      onSwipeableWillOpen={(_direction) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      }}
      onSwipeableOpen={(direction) => {
        if (direction === "right") handleSwipePlay();
        else handleSave();
        setTimeout(() => swipeableRef.current?.close(), 250);
      }}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
      >
        {story.media_url ? (
          <Image source={{ uri: story.media_url }} style={styles.media} resizeMode="cover" />
        ) : (
          <View style={[styles.media, styles.mediaPlaceholder]} />
        )}

        <View style={styles.body}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              {isPro && (
                <Pressable
                  onPress={handlePlayButton}
                  hitSlop={6}
                  style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="play-circle" size={22} color="#22C55E" />
                </Pressable>
              )}
              <CategoryBadge category={story.category} />
            </View>
            <View style={styles.actions}>
              {ticker ? (
                <View style={styles.tickerPill}>
                  <Text style={styles.tickerText}>${ticker}</Text>
                </View>
              ) : null}
              <SaveButton story={story} />
            </View>
          </View>

          <Text style={styles.title} numberOfLines={3}>
            {story.title}
          </Text>

          <Text style={styles.insight} numberOfLines={2}>
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
    </ReanimatedSwipeable>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    swipeContainer: {
      marginHorizontal: 16,
      marginBottom: 14,
      borderRadius: 18,
      overflow: "hidden",
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: 18,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: palette.border,
    },
    media: {
      width: "100%",
      height: 180,
      backgroundColor: palette.surfaceHigh,
    },
    mediaPlaceholder: {
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

export default StoryCard;
