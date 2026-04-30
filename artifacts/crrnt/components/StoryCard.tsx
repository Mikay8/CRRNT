import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import palette from "@/constants/colors";
import CategoryBadge from "@/components/CategoryBadge";
import SaveButton from "@/components/SaveButton";
import { useAudio } from "@/contexts/AudioContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import { formatRelativeTime, isToday } from "@/utils/time";
import type { Story } from "@workspace/api-client-react";

const SWIPE_THRESHOLD = 80;

interface StoryCardProps {
  story: Story;
}

export function StoryCard({ story }: StoryCardProps) {
  const translateX = useSharedValue(0);
  const { toggleSaved } = useSavedStories();
  const { playStory } = useAudio();

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    toggleSaved(story).catch(() => undefined);
  };

  const handlePlay = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    playStory(story).catch(() => undefined);
  };

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    router.push({ pathname: "/story/[id]", params: { id: story.articleId } });
  };

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (e.translationX < -SWIPE_THRESHOLD) {
        handleSave();
      } else if (e.translationX > SWIPE_THRESHOLD) {
        handlePlay();
      }
      translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
    });

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Play action fades in when swiping right (positive translateX)
  const playActionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [10, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));

  // Save action fades in when swiping left (negative translateX)
  const saveActionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, -10], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <View style={styles.swipeContainer}>
        {/* Play action — peeks from left when swiping right */}
        <Animated.View style={[styles.actionBg, styles.playBg, playActionStyle]}>
          <Ionicons name="play-circle" size={38} color="#fff" style={styles.actionIconLeft} />
        </Animated.View>

        {/* Save action — peeks from right when swiping left */}
        <Animated.View style={[styles.actionBg, styles.saveBg, saveActionStyle]}>
          <Ionicons name="bookmark" size={32} color="#fff" style={styles.actionIconRight} />
        </Animated.View>

        {/* Card slides on top of actions */}
        <Animated.View style={[styles.card, animatedCardStyle]}>
          <Pressable
            onPress={onPress}
            style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
          >
            {story.mediaUrl ? (
              <Image source={{ uri: story.mediaUrl }} style={styles.media} resizeMode="cover" />
            ) : (
              <View style={[styles.media, styles.mediaPlaceholder]} />
            )}

            <View style={styles.body}>
              <View style={styles.row}>
                <CategoryBadge category={story.category} />
                <View style={styles.actions}>
                  {story.ticker ? (
                    <View style={styles.tickerPill}>
                      <Text style={styles.tickerText}>${story.ticker}</Text>
                    </View>
                  ) : null}
                  <SaveButton story={story} />
                </View>
              </View>

              <Text style={styles.title} numberOfLines={3}>
                {story.title}
              </Text>

              <Text style={styles.insight} numberOfLines={2}>
                {story.insight}
              </Text>

              <View style={styles.footer}>
                <Text style={styles.source} numberOfLines={1}>
                  {story.source || "Marktr"}
                </Text>
                <View style={styles.footerRight}>
                  {isToday(story.publishedDate) ? (
                    <View style={styles.todayBadge}>
                      <Text style={styles.todayBadgeText}>Today</Text>
                    </View>
                  ) : null}
                  {story.publishedDate ? (
                    <Text style={styles.timestamp}>
                      {formatRelativeTime(story.publishedDate)}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  swipeContainer: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 18,
    overflow: "hidden",
  },
  actionBg: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
  },
  playBg: {
    backgroundColor: "#22C55E",
    justifyContent: "flex-start",
  },
  saveBg: {
    backgroundColor: palette.accent,
    justifyContent: "flex-end",
  },
  actionIconLeft: {
    marginLeft: 22,
  },
  actionIconRight: {
    marginRight: 22,
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

export default StoryCard;
