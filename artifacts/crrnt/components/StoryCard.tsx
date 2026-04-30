import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import palette from "@/constants/colors";
import CategoryBadge from "@/components/CategoryBadge";
import SaveButton from "@/components/SaveButton";
import { formatRelativeTime, isToday } from "@/utils/time";
import type { Story } from "@workspace/api-client-react";

interface StoryCardProps {
  story: Story;
}

export function StoryCard({ story }: StoryCardProps) {
  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    router.push({ pathname: "/story/[id]", params: { id: story.articleId } });
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}
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
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    overflow: "hidden",
    marginHorizontal: 16,
    marginBottom: 14,
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
