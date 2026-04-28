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
} from "@workspace/api-client-react";
import palette from "@/constants/colors";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import CategoryBadge from "@/components/CategoryBadge";
import PriceChart from "@/components/PriceChart";
import SaveButton from "@/components/SaveButton";
import EmptyState from "@/components/EmptyState";
import { formatRelativeTime, formatDateTime } from "@/utils/time";

type StockRange = "1d" | "5d" | "1mo" | "1y";

const RANGE_TABS: { label: string; value: StockRange; hint: string }[] = [
  { label: "1D",  value: "1d",  hint: "Today" },
  { label: "1W",  value: "5d",  hint: "This week" },
  { label: "1M",  value: "1mo", hint: "30 days" },
  { label: "1Y",  value: "1y",  hint: "1 year" },
];

export default function StoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { saved } = useSavedStories();
  const [stockRange, setStockRange] = useState<StockRange>("1d");

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
    { query: { enabled: !!ticker, staleTime: 5 * 60 * 1000 } as any }
  );

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

  const handleRangeChange = (r: StockRange) => {
    Haptics.selectionAsync().catch(() => undefined);
    setStockRange(r);
  };

  const activeTab = RANGE_TABS.find((t) => t.value === stockRange)!;

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

      <View style={[styles.content, { marginTop: -50, paddingHorizontal: hPad }]}>
        <View style={styles.metaRow}>
          <CategoryBadge category={story.category} size="md" />
          <SaveButton story={story} size={26} />
        </View>

        <Text style={styles.title}>{story.title}</Text>

        <Pressable onPress={openSource} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
          <Text style={styles.source}>
            {story.source}
            {story.publishedDate
              ? `  ·  ${formatRelativeTime(story.publishedDate)}  ·  ${formatDateTime(story.publishedDate)}`
              : ""}
            {"   "}
            <Ionicons name="open-outline" size={12} color={palette.textDim} />
          </Text>
        </Pressable>

        <View style={styles.insightCard}>
          <View style={styles.insightHeader}>
            <Ionicons name="sparkles" size={16} color={palette.accent} />
            <Text style={styles.insightLabel}>Marktr take</Text>
          </View>
          <Text style={styles.insight}>{story.insight}</Text>
          <Text style={styles.explanation}>{story.explanation}</Text>
        </View>

        {ticker ? (
          <View style={styles.stockCard}>
            {/* Header row: ticker + current price/delta */}
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
                    {activeTab.label}{" "}
                    {priceUp ? "▲" : "▼"}{" "}
                    {pctChange(stock.points[0]?.close, stock.latestPrice)}%
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Range tab selector */}
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
                          ? (priceUp ? palette.positive : palette.negative) + "22"
                          : "transparent",
                        borderColor: isActive
                          ? (priceUp ? palette.positive : palette.negative)
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
                            ? priceUp ? palette.positive : palette.negative
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

            {/* Chart */}
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

            {/* Context hint */}
            {stock && story.publishedDate ? (
              <Text style={styles.chartHint}>
                <Ionicons name="time-outline" size={11} color={palette.textDim} />{" "}
                Story posted {formatRelativeTime(story.publishedDate)} — showing {activeTab.hint}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.noTickerCard}>
            <Ionicons name="information-circle-outline" size={18} color={palette.textMuted} />
            <Text style={styles.noTickerText}>
              No public stock is closely tied to this story.
            </Text>
          </View>
        )}

        <Pressable
          onPress={openSource}
          style={({ pressed }) => [
            styles.sourceBtn,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="open-outline" size={16} color={palette.text} />
          <Text style={styles.sourceBtnText}>Read full story at {story.source}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function pctChange(start?: number, end?: number): string {
  if (!start || !end) return "0.00";
  return (((end - start) / start) * 100).toFixed(2);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.bg },
  hero: {
    width: "100%",
    height: 280,
    backgroundColor: palette.surfaceHigh,
  },
  heroPlaceholder: {
    backgroundColor: palette.surfaceHigh,
  },
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
  insightHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  insightLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    color: palette.accent,
    letterSpacing: 1,
    textTransform: "uppercase",
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
  price: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: palette.text,
  },
  delta: {
    marginTop: 2,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  rangeTabs: {
    flexDirection: "row",
    gap: 8,
  },
  rangeTab: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
  },
  rangeTabLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
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
