import {
  ActivityIndicator,
  Dimensions,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  useGetStockHistory,
  useGetStory,
  type Story,
  type Tweet,
} from "@workspace/api-client-react";
import palette from "@/constants/colors";
import { useAudio } from "@/contexts/AudioContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import CategoryBadge from "@/components/CategoryBadge";
import PriceChart from "@/components/PriceChart";
import SaveButton from "@/components/SaveButton";
import EmptyState from "@/components/EmptyState";
import { formatRelativeTime, formatDateTime } from "@/utils/time";

type StockRange = "1d" | "5d" | "1mo" | "1y";

const RANGE_TABS: { label: string; value: StockRange; hint: string }[] = [
  { label: "1D", value: "1d", hint: "Today" },
  { label: "1W", value: "5d", hint: "This week" },
  { label: "1M", value: "1mo", hint: "30 days" },
  { label: "1Y", value: "1y", hint: "1 year" },
];

const SENTIMENT_CONFIG = {
  concerned: {
    label: "Concerned",
    color: "#FF9500",
    icon: "alert-circle" as const,
  },
  hopeful: {
    label: "Hopeful",
    color: palette.positive,
    icon: "trending-up" as const,
  },
  angry: {
    label: "Angry",
    color: palette.negative,
    icon: "flame" as const,
  },
  divided: {
    label: "Divided",
    color: "#FFB347",
    icon: "swap-horizontal" as const,
  },
  unbothered: {
    label: "Unbothered",
    color: palette.textMuted,
    icon: "remove" as const,
  },
  mixed: { label: "Mixed", color: "#8B5CF6", icon: "shuffle" as const },
} as const;

export default function StoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { saved } = useSavedStories();
  const [stockRange, setStockRange] = useState<StockRange>("1d");
  const { story: audioStory, isPlaying, playStory, togglePlayPause } = useAudio();

  const localFallback = saved.find((s) => s.articleId === id) ?? null;

  const { data, isLoading, error } = useGetStory(id ?? "", {
    query: {
      enabled: !!id,
      placeholderData: localFallback ?? undefined,
    } as any,
  });

  const story: Story | null = (data as Story | undefined) ?? localFallback;

  const ticker = story?.ticker ?? null;
  const stockQuery = useGetStockHistory(
    ticker ?? "",
    { range: stockRange },
    { query: { enabled: !!ticker, staleTime: 5 * 60 * 1000 } as any },
  );

  const isThisStoryActive = !!story && audioStory?.articleId === story.articleId;
  const isThisStoryPlaying = isThisStoryActive && isPlaying;

  const screenWidth = Dimensions.get("window").width;
  const hPad = Math.max(16, insets.left + 4);
  const chartWidth = screenWidth - hPad * 2 - 32;

  if (isLoading && !story) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (!story) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 60 }]}>
        <EmptyState
          icon="alert-circle-outline"
          title="Story unavailable"
          message={
            error
              ? "We couldn't load this story right now."
              : "This story is no longer in today's feed."
          }
          actionLabel="Back to feed"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const stock = stockQuery.data;
  const priceUp =
    stock && stock.points.length >= 2
      ? stock.points[stock.points.length - 1].close >= stock.points[0].close
      : true;

  const openSource = () => {
    Haptics.selectionAsync().catch(() => undefined);
    if (story.link) Linking.openURL(story.link).catch(() => undefined);
  };

  const openTweet = (url: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    Linking.openURL(url).catch(() => undefined);
  };

  const handleRangeChange = (r: StockRange) => {
    Haptics.selectionAsync().catch(() => undefined);
    setStockRange(r);
  };

  const toggleAudio = async () => {
    if (!story) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (isThisStoryActive) {
      await togglePlayPause();
    } else {
      await playStory(story);
    }
  };

  const activeTab = RANGE_TABS.find((t) => t.value === stockRange)!;
  const tweets: Tweet[] = (story as any).tweets ?? [];
  const peopleSay: string | null = (story as any).peopleSay ?? null;
  const sentimentKey = ((story as any).sentiment ??
    "mixed") as keyof typeof SENTIMENT_CONFIG;
  const sentimentCfg =
    SENTIMENT_CONFIG[sentimentKey] ?? SENTIMENT_CONFIG.mixed;
  const hasSocialData = peopleSay || tweets.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      showsVerticalScrollIndicator={false}
      scrollIndicatorInsets={{ top: insets.top, bottom: insets.bottom }}
      automaticallyAdjustsScrollIndicatorInsets={false}
    >
      {story.mediaUrl ? (
        <Image
          source={{ uri: story.mediaUrl }}
          style={styles.hero}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.hero, styles.heroPlaceholder]} />
      )}

      <View style={[styles.heroOverlay, { height: insets.top + 220 }]} />

      <View
        style={[styles.content, { marginTop: -50, paddingHorizontal: hPad }]}
      >
        {/* Top row: category + action buttons */}
        <View style={styles.metaRow}>
          <CategoryBadge category={story.category} size="md" />
          <View style={styles.actionButtons}>
            {/* Audio play/stop button */}
            <Pressable
              onPress={toggleAudio}
              style={({ pressed }) => [
                styles.audioBtn,
                isThisStoryPlaying && styles.audioBtnActive,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              accessibilityLabel={isThisStoryPlaying ? "Pause audio" : "Listen to story"}
            >
              <Ionicons
                name={isThisStoryPlaying ? "pause" : "volume-high"}
                size={16}
                color={isThisStoryPlaying ? palette.bg : palette.accent}
              />
            </Pressable>
            <SaveButton story={story} size={26} />
          </View>
        </View>

        <Text style={styles.title}>{story.title}</Text>

        <Pressable
          onPress={openSource}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={styles.source}>
            {story.source}
            {story.publishedDate
              ? `  ·  ${formatRelativeTime(story.publishedDate)}  ·  ${formatDateTime(story.publishedDate)}`
              : ""}
            {"   "}
            <Ionicons name="open-outline" size={12} color={palette.textDim} />
          </Text>
        </Pressable>
        {/* ── story summary ──────────────────────────────────── */}
        <View style={styles.insightCard}>
          <Text style={styles.insight}>{story.storySummary ?? story.insight}</Text>
        </View>
        {/* ── How does it affect me? ───────────────────────────────── */}
        {(story as any).lifeImpact ? (
          <View style={[styles.insightCard, styles.impactCard]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="people" size={16} color="#7B68EE" />
              <Text style={[styles.sectionLabel, { color: "#7B68EE" }]}>
                How does it affect me?
              </Text>
            </View>
            <Text style={styles.impactText}>{(story as any).lifeImpact}</Text>
          </View>
        ) : null}
        {/* ── Wallet impact ──────────────────────────────────────────── */}
        <View style={styles.insightCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="sparkles" size={16} color={palette.accent} />
            <Text style={styles.sectionLabel}>Wallet impact</Text>
          </View>
          <Text style={styles.impactText}>{(story as any).walletImpact}</Text>
        </View>
        {/* ── Stock chart ──────────────────────────────────────────── */}
        {ticker ? (
          <View style={styles.stockCard}>
            <View style={styles.stockHeader}>
              <View>
                <Text style={styles.tickerLabel}>${ticker}</Text>
                {story.companyName ? (
                  <Text style={styles.company}>{story.companyName}</Text>
                ) : null}
              </View>
              {stock ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.price}>
                    ${stock.latestPrice?.toFixed(2)}
                  </Text>
                  <Text
                    style={[
                      styles.delta,
                      { color: priceUp ? palette.positive : palette.negative },
                    ]}
                  >
                    {activeTab.label} {priceUp ? "▲" : "▼"}{" "}
                    {pctChange(stock.points[0]?.close, stock.latestPrice)}%
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.rangeTabs}>
              {RANGE_TABS.map((tab) => {
                const isActive = tab.value === stockRange;
                return (
                  <Pressable
                    key={tab.value}
                    onPress={() => handleRangeChange(tab.value)}
                    style={({ pressed }) => [
                      styles.rangeTab,
                      {
                        backgroundColor: isActive
                          ? (priceUp ? palette.positive : palette.negative) +
                            "22"
                          : "transparent",
                        borderColor: isActive
                          ? priceUp
                            ? palette.positive
                            : palette.negative
                          : palette.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rangeTabLabel,
                        {
                          color: isActive
                            ? priceUp
                              ? palette.positive
                              : palette.negative
                            : palette.textMuted,
                        },
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {stockQuery.isLoading ? (
              <View style={[styles.chartPlaceholder, { width: chartWidth }]}>
                <ActivityIndicator color={palette.textMuted} />
              </View>
            ) : stock ? (
              <PriceChart
                points={stock.points}
                width={chartWidth}
                height={160}
                positive={priceUp}
              />
            ) : (
              <View style={[styles.chartPlaceholder, { width: chartWidth }]}>
                <Text style={styles.chartEmpty}>Price data unavailable</Text>
              </View>
            )}

            {stock && story.publishedDate ? (
              <Text style={styles.chartHint}>
                <Ionicons
                  name="time-outline"
                  size={11}
                  color={palette.textDim}
                />{" "}
                Story posted {formatRelativeTime(story.publishedDate)} — showing{" "}
                {activeTab.hint}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.noTickerCard}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={palette.textMuted}
            />
            <Text style={styles.noTickerText}>
              No public stock is closely tied to this story.
            </Text>
          </View>
        )}

        {/* ── What are people saying? ──────────────────────────────── */}
        {hasSocialData ? (
          <View style={[styles.insightCard, styles.socialCard]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.xLogo}>𝕏</Text>
              <Text style={[styles.sectionLabel, { color: "#1DA1F2" }]}>
                What are people saying?
              </Text>
            </View>

            {/* Sentiment badge — hidden when tweets were irrelevant/scammy */}
            {(story as any).sentiment ? (
              <View style={styles.sentimentRow}>
                <View
                  style={[
                    styles.sentimentBadge,
                    {
                      backgroundColor: sentimentCfg.color + "22",
                      borderColor: sentimentCfg.color + "55",
                    },
                  ]}
                >
                  <Ionicons
                    name={sentimentCfg.icon}
                    size={13}
                    color={sentimentCfg.color}
                  />
                  <Text
                    style={[styles.sentimentLabel, { color: sentimentCfg.color }]}
                  >
                    {sentimentCfg.label}
                  </Text>
                </View>
              </View>
            ) : null}

            {peopleSay ? (
              <Text style={styles.peopleSay}>{peopleSay}</Text>
            ) : null}

            {tweets.length > 0 ? (
              <View style={styles.tweetList}>
                {tweets.map((tweet) => (
                  <Pressable
                    key={tweet.id}
                    onPress={() => openTweet(tweet.url)}
                    style={({ pressed }) => [
                      styles.tweetCard,
                      { opacity: pressed ? 0.75 : 1 },
                    ]}
                  >
                    <View style={styles.tweetHeader}>
                      <View style={styles.tweetAvatar}>
                        <Text style={styles.tweetAvatarText}>
                          {tweet.authorName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tweetAuthorName} numberOfLines={1}>
                          {tweet.authorName}
                        </Text>
                        <Text style={styles.tweetHandle} numberOfLines={1}>
                          {tweet.author}
                        </Text>
                      </View>
                      <Ionicons
                        name="open-outline"
                        size={12}
                        color={palette.textDim}
                      />
                    </View>
                    <Text style={styles.tweetText} numberOfLines={3}>
                      {tweet.text}
                    </Text>
                    <View style={styles.tweetStats}>
                      <View style={styles.tweetStat}>
                        <Ionicons
                          name="heart-outline"
                          size={12}
                          color={palette.textDim}
                        />
                        <Text style={styles.tweetStatText}>
                          {formatCount(tweet.likes)}
                        </Text>
                      </View>
                      <View style={styles.tweetStat}>
                        <Ionicons
                          name="repeat-outline"
                          size={12}
                          color={palette.textDim}
                        />
                        <Text style={styles.tweetStatText}>
                          {formatCount(tweet.retweets)}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Read full story ──────────────────────────────────────── */}
        <Pressable
          onPress={openSource}
          style={({ pressed }) => [
            styles.sourceBtn,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="open-outline" size={16} color={palette.text} />
          <Text style={styles.sourceBtnText}>
            Read full story at {story.source}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function pctChange(start?: number, end?: number): string {
  if (!start || !end) return "0.00";
  return (((end - start) / start) * 100).toFixed(2);
}

function formatCount(n: number | undefined): string {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.bg,
  },
  hero: { width: "100%", height: 280, backgroundColor: palette.surfaceHigh },
  heroPlaceholder: { backgroundColor: palette.surfaceHigh },
  heroOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "transparent",
  },
  content: {
    gap: 16,
    backgroundColor: palette.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 22,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  actionButtons: { flexDirection: "row", alignItems: "center", gap: 10 },
  audioBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  audioBtnActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
    lineHeight: 32,
    color: palette.text,
    letterSpacing: -0.5,
  },
  source: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: palette.textDim,
  },
  insightCard: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  impactCard: {
    borderColor: "#7B68EE44",
    backgroundColor: "#7B68EE0A",
  },
  socialCard: {
    borderColor: "#1DA1F233",
    backgroundColor: "#1DA1F20A",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    color: palette.accent,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  xLogo: {
    fontSize: 14,
    fontWeight: "900",
    color: "#1DA1F2",
    lineHeight: 18,
  },
  insight: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    lineHeight: 24,
    color: palette.text,
  },
  explanation: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    color: palette.textMuted,
    marginTop: 4,
  },
  impactText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 22,
    color: palette.text,
  },
  stockCard: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
  },
  stockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  tickerLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: palette.text,
    letterSpacing: 0.5,
  },
  company: {
    marginTop: 2,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: palette.textMuted,
  },
  price: { fontFamily: "Inter_700Bold", fontSize: 20, color: palette.text },
  delta: { marginTop: 2, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  rangeTabs: { flexDirection: "row", gap: 8 },
  rangeTab: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
  },
  rangeTabLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  chartPlaceholder: {
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.bgElevated,
    borderRadius: 12,
  },
  chartEmpty: {
    fontFamily: "Inter_500Medium",
    color: palette.textDim,
    fontSize: 13,
  },
  chartHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: palette.textDim,
    textAlign: "center",
    marginTop: -4,
  },
  noTickerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  noTickerText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: palette.textMuted,
    flex: 1,
  },
  // Social / Twitter section
  sentimentRow: { flexDirection: "row", alignItems: "center" },
  sentimentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  sentimentLabel: { fontFamily: "Inter_700Bold", fontSize: 12 },
  peopleSay: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    color: palette.textMuted,
  },
  tweetList: { gap: 10, marginTop: 4 },
  tweetCard: {
    backgroundColor: palette.bgElevated,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  tweetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  tweetAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1DA1F233",
    alignItems: "center",
    justifyContent: "center",
  },
  tweetAvatarText: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: "#1DA1F2",
  },
  tweetAuthorName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: palette.text,
  },
  tweetHandle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: palette.textDim,
  },
  tweetText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    color: palette.textMuted,
  },
  tweetStats: { flexDirection: "row", gap: 16 },
  tweetStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  tweetStatText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: palette.textDim,
  },
  sourceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: palette.bgElevated,
    borderWidth: 1,
    borderColor: palette.border,
    marginTop: 4,
  },
  sourceBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: palette.text,
  },
});
