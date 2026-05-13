import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetStockHistory,
  useGetStory,
  type Story,
} from "@workspace/api-client-react";
import { getCategoryMeta } from "@/constants/categories";
import { useAudio } from "@/contexts/AudioContext";
import { usePurchases } from "@/contexts/PurchasesContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";
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

type SentimentKey =
  | "mostly positive"
  | "mostly frustrated"
  | "split"
  | "surprisingly calm"
  | "not enough data";

const SENTIMENT_CONFIG: Record<
  SentimentKey,
  { label: string; color: string; icon: string }
> = {
  "mostly positive": {
    label: "Mostly Positive",
    color: "#22C55E",
    icon: "trending-up",
  },
  "mostly frustrated": {
    label: "Mostly Frustrated",
    color: "#EF4444",
    icon: "flame",
  },
  split: { label: "Split", color: "#F59E0B", icon: "swap-horizontal" },
  "surprisingly calm": {
    label: "Surprisingly Calm",
    color: "#8B5CF6",
    icon: "remove",
  },
  "not enough data": {
    label: "Not Enough Data",
    color: "#6B7280",
    icon: "help-circle",
  },
};

const FALLBACK_SENTIMENT: (typeof SENTIMENT_CONFIG)[SentimentKey] = {
  label: "Mixed",
  color: "#8B5CF6",
  icon: "shuffle",
};

/** Extract ticker symbol from stock_note like "AAPL (Apple Inc.)" */
function parseTickerFromStockNote(stockNote?: string | null): string | null {
  if (!stockNote) return null;
  const match = stockNote.match(/^([A-Z]{1,5})\b/);
  return match ? match[1] : null;
}

/** Extract company name from stock_note like "AAPL (Apple Inc.)" */
function parseCompanyFromStockNote(stockNote?: string | null): string | null {
  if (!stockNote) return null;
  const match = stockNote.match(/^[A-Z]{1,5}\s+\((.+)\)/);
  return match ? match[1] : null;
}

/** Extract domain from a source URL */
function sourceDomain(url?: string | null): string {
  if (!url) return "CRRNT";
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "");
  } catch {
    return "CRRNT";
  }
}

export default function StoryDetailScreen() {
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isPro } = usePurchases();
  const { saved } = useSavedStories();
  const [stockRange, setStockRange] = useState<StockRange>("1d");
  const [audioTrackWidth, setAudioTrackWidth] = useState(0);
  const audioTrackWidthRef = useRef(0);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const seekHoldRef = useRef<number | null>(null);
  const {
    story: audioStory,
    isPlaying,
    isAudioLoading,
    isBarVisible,
    positionMs,
    durationMs,
    playStory,
    togglePlayPause,
    seekTo,
  } = useAudio();

  const localFallback = saved.find((s) => s.id === id) ?? null;

  const { data, isLoading, error } = useGetStory(id ?? "", {
    query: {
      enabled: !!id,
      placeholderData: localFallback ?? undefined,
    } as any,
  });

  const story: Story | null = (data as Story | undefined) ?? localFallback;

  const ticker = parseTickerFromStockNote(story?.stock_note);
  const companyName = parseCompanyFromStockNote(story?.stock_note);
  const displaySource = sourceDomain(story?.source_url);

  const stockQuery = useGetStockHistory(
    ticker ?? "",
    { range: stockRange },
    { query: { enabled: !!ticker, staleTime: 5 * 60 * 1000 } as any }
  );

  const isThisStoryActive =
    !!story && audioStory?.id === story.id;
  const isThisStoryPlaying = isThisStoryActive && isPlaying;

  const showFloat =
    isBarVisible &&
    !!audioStory &&
    !!story &&
    audioStory.id !== story.id;
  const floatAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(floatAnim, {
      toValue: showFloat ? 1 : 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [showFloat]);
  const audioStoryCatColor =
    (audioStory ? getCategoryMeta(audioStory.category)?.color : null) ??
    palette.accent;

  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const liveProgress =
    isThisStoryActive && durationMs > 0 ? positionMs / durationMs : 0;

  if (seekHoldRef.current !== null && durationMs > 0) {
    const targetMs = seekHoldRef.current * durationMs;
    if (Math.abs(positionMs - targetMs) < 1500) {
      seekHoldRef.current = null;
    }
  }

  const heldProgress = seekHoldRef.current;
  const displayProgress =
    scrubProgress !== null
      ? scrubProgress
      : heldProgress !== null
        ? heldProgress
        : liveProgress;
  const displayMs =
    scrubProgress !== null
      ? scrubProgress * durationMs
      : heldProgress !== null
        ? heldProgress * durationMs
        : positionMs;

  const isThisStoryActiveRef = useRef(false);
  isThisStoryActiveRef.current = isThisStoryActive;
  const durationMsRef = useRef(0);
  durationMsRef.current = durationMs;
  const seekToRef = useRef(seekTo);
  seekToRef.current = seekTo;

  const seekGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      if (!isThisStoryActiveRef.current || audioTrackWidthRef.current === 0)
        return;
      const p = clamp(e.x / audioTrackWidthRef.current);
      scrubRef.current = p;
      setScrubProgress(p);
    })
    .onUpdate((e) => {
      if (!isThisStoryActiveRef.current || audioTrackWidthRef.current === 0)
        return;
      const p = clamp(e.x / audioTrackWidthRef.current);
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
    if (story.source_url)
      Linking.openURL(story.source_url).catch(() => undefined);
  };

  const handleRangeChange = (r: StockRange) => {
    Haptics.selectionAsync().catch(() => undefined);
    setStockRange(r);
  };

  const toggleAudio = async () => {
    if (!story) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined
    );
    if (isThisStoryActive) {
      await togglePlayPause();
    } else {
      await playStory(story);
    }
  };

  const activeTab = RANGE_TABS.find((t) => t.value === stockRange)!;
  const sentimentKey = story.sentiment_label as SentimentKey | null | undefined;
  const sentimentCfg =
    sentimentKey && SENTIMENT_CONFIG[sentimentKey]
      ? SENTIMENT_CONFIG[sentimentKey]
      : FALLBACK_SENTIMENT;
  const hasSocialData = story.people_say;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        scrollIndicatorInsets={{ top: insets.top, bottom: insets.bottom }}
        automaticallyAdjustsScrollIndicatorInsets={false}
      >
        {story.media_url ? (
          <Image
            source={{ uri: story.media_url }}
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
          {/* Top row: category + save */}
          <View style={styles.metaRow}>
            <View style={styles.badgeRow}>
              <CategoryBadge category={story.category} size="md" />
              {story.tier === "paid" && (
                <View style={styles.proBadge}>
                  <Ionicons name="star" size={9} color="#000" />
                  <Text style={styles.proBadgeText}>PRO</Text>
                </View>
              )}
            </View>
            <View style={styles.actionButtons}>
              <SaveButton story={story} size={26} />
            </View>
          </View>

          <Text style={styles.title}>{story.title}</Text>

          {/* Audio player row */}
          {(
            <View style={styles.audioRow}>
              <Pressable
                onPress={toggleAudio}
                disabled={isAudioLoading && isThisStoryActive}
                style={({ pressed }) => [
                  styles.audioPlayBtn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityLabel={isThisStoryPlaying ? "Pause audio" : "Play audio"}
              >
                {isAudioLoading && isThisStoryActive ? (
                  <ActivityIndicator size="small" color={palette.bg} />
                ) : (
                  <Ionicons
                    name={isThisStoryPlaying ? "pause" : "play"}
                    size={14}
                    color={palette.bg}
                  />
                )}
              </Pressable>
              <GestureDetector gesture={seekGesture}>
                <View
                  accessible={isThisStoryActive}
                  accessibilityLabel="Seek bar"
                  accessibilityRole="adjustable"
                  style={[
                    styles.audioTrack,
                    Platform.OS === "web" && isThisStoryActive
                      ? ({ cursor: "pointer" } as object)
                      : undefined,
                  ]}
                  onLayout={(e) => {
                    const w = e.nativeEvent.layout.width;
                    audioTrackWidthRef.current = w;
                    setAudioTrackWidth(w);
                  }}
                >
                  <View style={styles.audioRail} />
                  <View
                    style={[
                      styles.audioFill,
                      {
                        width:
                          audioTrackWidth > 0
                            ? Math.min(
                                displayProgress * audioTrackWidth,
                                audioTrackWidth
                              )
                            : 0,
                      },
                    ]}
                  />
                </View>
              </GestureDetector>
              {isThisStoryActive ? (
                <Text style={styles.audioTime}>
                  {formatMs(displayMs)} /{" "}
                  {durationMs > 0 ? formatMs(durationMs) : "--:--"}
                </Text>
              ) : null}
            </View>
          )}

          <Pressable
            onPress={openSource}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={styles.source}>
              {displaySource}
              {story.published_at
                ? `  ·  ${formatRelativeTime(story.published_at)}  ·  ${formatDateTime(story.published_at)}`
                : ""}
              {"   "}
              <Ionicons
                name="open-outline"
                size={12}
                color={palette.textDim}
              />
            </Text>
          </Pressable>

          {/* Story summary */}
          <View style={styles.insightCard}>
            <Text style={styles.insight}>
              {story.summary ?? story.one_liner}
            </Text>
          </View>

          {/* How does it affect me? */}
          {(story.life_impact || story.personalized_life_impact) ? (
            <View style={[styles.insightCard, styles.impactCard]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="people" size={16} color="#7B68EE" />
                <Text style={[styles.sectionLabel, { color: "#7B68EE" }]}>
                  How does it affect me?
                </Text>
              </View>
              <Text style={styles.impactText}>
                {isPro && story.personalized_life_impact
                  ? story.personalized_life_impact
                  : story.life_impact}
              </Text>
              {isPro && story.personalized_life_impact ? (
                <Text style={styles.personalizedBadge}>Personalized for you</Text>
              ) : null}
            </View>
          ) : null}

          {/* Wallet impact */}
          {story.wallet_impact ? (
            <View style={styles.insightCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="sparkles" size={16} color={palette.accent} />
                <Text style={styles.sectionLabel}>Wallet impact</Text>
              </View>
              <Text style={styles.impactText}>{story.wallet_impact}</Text>
            </View>
          ) : !isPro ? (
            <Pressable
              onPress={() => router.push("/subscription/manage")}
              style={[styles.insightCard, styles.lockedCard]}
            >
              <View style={styles.sectionHeader}>
                <Ionicons name="sparkles" size={16} color={palette.accent} />
                <Text style={styles.sectionLabel}>Wallet impact</Text>
              </View>
              <Text style={styles.lockedPlaceholder}>
                {"██████████████████████████\n█████████████████"}
              </Text>
              <View style={styles.lockedBadge}>
                <Ionicons name="lock-closed" size={12} color={palette.accent} />
                <Text style={styles.lockedBadgeText}>Unlock with CRRNT Pro</Text>
              </View>
            </Pressable>
          ) : null}

          {/* Stock chart */}
          {ticker ? (
              <View style={styles.stockCard}>
                <View style={styles.stockHeader}>
                  <View>
                    <Text style={styles.tickerLabel}>${ticker}</Text>
                    {companyName ? (
                      <Text style={styles.company}>{companyName}</Text>
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
                          {
                            color: priceUp ? palette.positive : palette.negative,
                          },
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

                {stock && story.published_at ? (
                  <Text style={styles.chartHint}>
                    <Ionicons
                      name="time-outline"
                      size={11}
                      color={palette.textDim}
                    />{" "}
                    Story posted {formatRelativeTime(story.published_at)} —
                    showing {activeTab.hint}
                  </Text>
                ) : null}
              </View>
            ) : !isPro ? (
              <Pressable
                onPress={() => router.push("/subscription/manage")}
                style={[styles.stockCard, styles.lockedCard]}
              >
                <View style={styles.sectionHeader}>
                  <Ionicons name="bar-chart-outline" size={16} color={palette.accent} />
                  <Text style={styles.sectionLabel}>Stock data</Text>
                </View>
                <View style={[styles.chartPlaceholder, { width: chartWidth }]}>
                  <Ionicons name="lock-closed" size={22} color={palette.textMuted} />
                </View>
                <View style={styles.lockedBadge}>
                  <Ionicons name="lock-closed" size={12} color={palette.accent} />
                  <Text style={styles.lockedBadgeText}>Unlock with CRRNT Pro</Text>
                </View>
              </Pressable>
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

          {/* What are people saying? */}
          {hasSocialData ? (
            <View style={[styles.insightCard, styles.socialCard]}>
              <View style={styles.sectionHeader}>
                <Text style={styles.xLogo}>𝕏</Text>
                <Text style={[styles.sectionLabel, { color: "#1DA1F2" }]}>
                  What are people saying?
                </Text>
              </View>

              {story.sentiment_label ? (
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
                      name={sentimentCfg.icon as any}
                      size={13}
                      color={sentimentCfg.color}
                    />
                    <Text
                      style={[
                        styles.sentimentLabel,
                        { color: sentimentCfg.color },
                      ]}
                    >
                      {sentimentCfg.label}
                    </Text>
                  </View>
                </View>
              ) : null}

              {story.people_say ? (
                <Text style={styles.peopleSay}>{story.people_say}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Read full story */}
          <Pressable
            onPress={openSource}
            style={({ pressed }) => [
              styles.sourceBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="open-outline" size={16} color={palette.text} />
            <Text style={styles.sourceBtnText}>
              Read full story at {displaySource}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Floating play/pause — visible when a different story is actively playing */}
      {<Animated.View
        pointerEvents={showFloat ? "auto" : "none"}
        style={[
          styles.floatingPlayBtn,
          {
            bottom: insets.bottom + 24,
            backgroundColor: audioStoryCatColor,
            opacity: floatAnim,
            transform: [{ scale: floatAnim }],
          },
        ]}
      >
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
              () => undefined
            );
            togglePlayPause();
          }}
          style={styles.floatingPlayBtnInner}
        >
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={22}
            color="#fff"
            style={isPlaying ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
      </Animated.View>}
    </View>
  );
}

function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function pctChange(start?: number, end?: number): string {
  if (!start || !end) return "0.00";
  return (((end - start) / start) * 100).toFixed(2);
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: palette.bg },
    scrollView: { flex: 1, backgroundColor: palette.bg },
    floatingPlayBtn: {
      position: "absolute",
      right: 20,
      width: 52,
      height: 52,
      borderRadius: 26,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 10,
    },
    floatingPlayBtnInner: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
    },
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
    badgeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    proBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 10,
      backgroundColor: palette.accent,
    },
    proBadgeText: {
      fontSize: 10,
      fontWeight: "800",
      color: "#000",
      letterSpacing: 0.5,
    },
    actionButtons: { flexDirection: "row", alignItems: "center", gap: 10 },
    audioRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    audioPlayBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: palette.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    audioTrack: {
      flex: 1,
      height: 28,
      justifyContent: "center",
    },
    audioRail: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: palette.border,
      borderRadius: 1,
    },
    audioFill: {
      position: "absolute",
      left: 0,
      height: 2,
      backgroundColor: palette.accent,
      borderRadius: 1,
    },
    audioTime: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: palette.textMuted,
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
    personalizedPlayBtn: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "#7B68EE22",
      borderWidth: 1,
      borderColor: "#7B68EE55",
      alignItems: "center",
      justifyContent: "center",
      marginLeft: "auto",
    },
    personalizedBadge: {
      fontFamily: "Inter_500Medium",
      fontSize: 11,
      color: "#7B68EE",
      opacity: 0.7,
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
    lockedCard: {
      borderColor: palette.accent + "33",
    },
    lockedPlaceholder: {
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      lineHeight: 22,
      color: palette.textMuted,
      opacity: 0.25,
      letterSpacing: -1,
    },
    lockedBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      alignSelf: "flex-start",
      backgroundColor: palette.accent + "18",
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: palette.accent + "44",
    },
    lockedBadgeText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 12,
      color: palette.accent,
    },
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
}
