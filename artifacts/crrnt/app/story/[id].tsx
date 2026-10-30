import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Extrapolation,
  FadeInDown,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useGetStockHistory,
  useGetStory,
  useListStories,
  type Story,
} from "@workspace/api-client-react";
import { CATEGORY_ICONS, getCategoryMeta } from "@/constants/categories";
import StoryImage from "@/components/StoryImage";
import { useAudio } from "@/contexts/AudioContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import { useAuth } from "@/contexts/AuthContext";
import { canSaveStories } from "@/constants/features";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";
import CategoryBadge from "@/components/CategoryBadge";
import PhotoCredit from "@/components/PhotoCredit";
import PriceChart from "@/components/PriceChart";
import SaveButton from "@/components/SaveButton";
import EmptyState from "@/components/EmptyState";
import { DetachedTabBar } from "@/components/GlassTabBar";
import { useChromeBottomPadding, useNavChrome } from "@/contexts/NavChromeContext";
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

/** How much of the hero shows above the sheet before scrolling. */
const SHEET_TOP = 350;
/** Hero height; the extra past SHEET_TOP sits under the sheet's rounded corners. */
const HERO_H = 410;
/** Glass button row height below the safe-area inset. */
const TOP_ROW_H = 60;

export default function StoryDetailScreen() {
  const { theme: palette, isDark } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { saved } = useSavedStories();
  const [stockRange, setStockRange] = useState<StockRange>("1d");
  const { story: audioStory, isPlaying, isAudioLoading, playStory, togglePlayPause } =
    useAudio();
  const { isCollapsed, setCollapsed } = useNavChrome();
  const bottomPad = useChromeBottomPadding();

  // The nav stays tucked into its single button here so the story gets the
  // room; hand it back expanded on the way out.
  useEffect(() => {
    setCollapsed(true);
    return () => setCollapsed(false);
  }, [setCollapsed]);

  const localFallback = saved.find((s) => s.id === id) ?? null;

  const { data, isLoading, error } = useGetStory(id ?? "", {
    query: {
      enabled: !!id,
      placeholderData: localFallback ?? undefined,
    } as any,
  });

  const story: Story | null = (data as Story | undefined) ?? localFallback;

  // Same query the unfiltered feed uses, so "Up next" is usually a cache hit.
  const feed = useListStories(undefined, {
    query: { staleTime: 60_000 } as any,
  });
  const nextStory = useMemo(() => {
    const list: Story[] = feed.data?.stories ?? [];
    if (!story || list.length < 2) return null;
    const idx = list.findIndex((s) => s.id === story.id);
    if (idx === -1) return list[0];
    return list[(idx + 1) % list.length];
  }, [feed.data, story?.id]);

  const ticker = parseTickerFromStockNote(story?.stock_note);
  const companyName = parseCompanyFromStockNote(story?.stock_note);
  const displaySource = sourceDomain(story?.source_url);

  const stockQuery = useGetStockHistory(
    ticker ?? "",
    { range: stockRange },
    { query: { enabled: !!ticker, staleTime: 5 * 60 * 1000 } as any }
  );

  const isThisStoryActive = !!story && audioStory?.id === story.id;
  const isThisStoryPlaying = isThisStoryActive && isPlaying;

  // Scroll drives the hero parallax / overscroll stretch, the hero dimming
  // as the sheet covers it, the compact title bar fading in, and the nav
  // tucking back away if it was tapped open.
  const scrollY = useSharedValue(0);
  const navOpen = useSharedValue(false);
  useEffect(() => {
    navOpen.value = !isCollapsed;
  }, [isCollapsed, navOpen]);
  const onScroll = useAnimatedScrollHandler((e) => {
    const y = e.contentOffset.y;
    if (navOpen.value && y > scrollY.value + 6) {
      navOpen.value = false;
      runOnJS(setCollapsed)(true);
    }
    scrollY.value = y;
  });
  const barH = insets.top + TOP_ROW_H;

  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    const scale = y < 0 ? 1 + -y / HERO_H : 1;
    // Scale grows about the centre; shift down so the top edge stays pinned.
    const pin = (HERO_H * (scale - 1)) / 2;
    return {
      transform: [{ translateY: (y > 0 ? -y * 0.4 : 0) + pin }, { scale }],
    };
  });
  const shadeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(0.75, (Math.max(0, scrollY.value) / SHEET_TOP) * 0.75),
  }));
  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [SHEET_TOP - barH - 40, SHEET_TOP - barH],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));
  const barTitleStyle = useAnimatedStyle(() => {
    const o = interpolate(
      scrollY.value,
      [SHEET_TOP + 90, SHEET_TOP + 130],
      [0, 1],
      Extrapolation.CLAMP
    );
    return { opacity: o, transform: [{ translateY: (1 - o) * 8 }] };
  });

  const screenWidth = Dimensions.get("window").width;
  const hPad = Math.max(20, insets.left + 4);
  const chartWidth = screenWidth - hPad * 2 - 32;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

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
          onAction={goBack}
        />
      </View>
    );
  }

  const title = story.display_title || story.title;
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

  const share = () => {
    Haptics.selectionAsync().catch(() => undefined);
    Share.share({
      message: [title, story.source_url].filter(Boolean).join("\n"),
    }).catch(() => undefined);
  };

  const handleRangeChange = (r: StockRange) => {
    Haptics.selectionAsync().catch(() => undefined);
    setStockRange(r);
  };

  const toggleAudio = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined
    );
    if (isThisStoryActive) {
      await togglePlayPause();
    } else {
      await playStory(story);
    }
  };

  const openNext = () => {
    if (!nextStory) return;
    Haptics.selectionAsync().catch(() => undefined);
    router.push({ pathname: "/story/[id]", params: { id: nextStory.id } });
  };

  const activeTab = RANGE_TABS.find((t) => t.value === stockRange)!;
  const sentimentKey = story.sentiment_label as SentimentKey | null | undefined;
  const sentimentCfg =
    sentimentKey && SENTIMENT_CONFIG[sentimentKey]
      ? SENTIMENT_CONFIG[sentimentKey]
      : FALLBACK_SENTIMENT;
  const hasSocialData = story.people_say;
  const days = daysRemaining(story.expires_at);
  const nextMeta = nextStory ? getCategoryMeta(nextStory.category) : null;

  return (
    <View style={styles.container}>
      {/* Hero: fixed behind the scroll view, parallaxes up and dims as the sheet covers it */}
      <Animated.View style={[styles.hero, { height: HERO_H }, heroStyle]}>
        <StoryImage
          uri={story.media_url}
          category={story.category}
          style={StyleSheet.absoluteFill}
        />
        <Svg style={styles.heroScrim} width="100%" height={140}>
          <Defs>
            <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#0A0E15" stopOpacity={0.6} />
              <Stop offset="1" stopColor="#0A0E15" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#scrim)" />
        </Svg>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: palette.bg },
            shadeStyle,
          ]}
        />
      </Animated.View>

      <Animated.ScrollView
        style={styles.scrollView}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
      >
        {/* Transparent window onto the hero. The credit lives here (not on
            the hero) so it stays tappable above the scroll view. */}
        <View style={{ height: SHEET_TOP }} pointerEvents="box-none">
          {story.image_credit_name ? (
            <PhotoCredit
              name={story.image_credit_name}
              profileUrl={story.image_credit_url}
              bottom={16}
            />
          ) : null}
        </View>

        <Animated.View
          entering={FadeInDown.duration(550)}
          style={[styles.sheet, { paddingHorizontal: hPad }]}
        >
          <View style={styles.grab} />

          <View style={styles.tagsRow}>
            <CategoryBadge category={story.category} size="lg" />
            {days !== null ? (
              <View style={[styles.leftPill, days <= 2 && styles.leftPillUrgent]}>
                <Ionicons
                  name="time-outline"
                  size={13}
                  color={days <= 2 ? "#EF4444" : palette.textMuted}
                />
                <Text
                  style={[styles.leftPillText, days <= 2 && styles.leftPillTextUrgent]}
                >
                  {days === 0 ? "Expires today" : `${days}d left`}
                </Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={toggleAudio}
              disabled={isAudioLoading && isThisStoryActive}
              accessibilityLabel={isThisStoryPlaying ? "Pause audio" : "Play audio"}
              style={({ pressed }) => [
                styles.playBtn,
                isThisStoryPlaying && styles.playBtnOn,
                { transform: [{ scale: pressed ? 0.94 : 1 }] },
              ]}
            >
              {isAudioLoading && isThisStoryActive ? (
                <ActivityIndicator size="small" color={palette.onAccent} />
              ) : (
                <Ionicons
                  name={isThisStoryPlaying ? "pause" : "play"}
                  size={18}
                  color={palette.onAccent}
                  style={isThisStoryPlaying ? undefined : { marginLeft: 2 }}
                />
              )}
            </Pressable>
          </View>

          <Text style={styles.title}>{title}</Text>

          <Text style={styles.meta}>
            <Text style={styles.metaSource}>{displaySource}</Text>
            {story.published_at
              ? `  ·  ${formatRelativeTime(story.published_at)}  ·  ${formatDateTime(story.published_at)}`
              : ""}
          </Text>

          <Text style={styles.summary}>{story.summary ?? story.one_liner}</Text>

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
                {story.personalized_life_impact ?? story.life_impact}
              </Text>
              {story.personalized_life_impact ? (
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
                  const tone = priceUp ? palette.positive : palette.negative;
                  return (
                    <Pressable
                      key={tab.value}
                      onPress={() => handleRangeChange(tab.value)}
                      style={({ pressed }) => [
                        styles.rangeTab,
                        {
                          backgroundColor: isActive ? tone + "22" : "transparent",
                          borderColor: isActive ? tone : palette.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.rangeTabLabel,
                          { color: isActive ? tone : palette.textMuted },
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
                  <Ionicons name="time-outline" size={11} color={palette.textDim} />{" "}
                  Story posted {formatRelativeTime(story.published_at)} — showing{" "}
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
                    <Text style={[styles.sentimentLabel, { color: sentimentCfg.color }]}>
                      {sentimentCfg.label}
                    </Text>
                  </View>
                </View>
              ) : null}

              {story.people_say ? (
                <Text style={styles.peopleSay}>{story.people_say}</Text>
              ) : null}

              {story.featured_posts && story.featured_posts.length > 0 ? (
                <View style={styles.postsList}>
                  {story.featured_posts.map((post, i) => (
                    <Pressable
                      key={post.url ?? i}
                      onPress={() => {
                        if (post.url) {
                          Linking.openURL(post.url).catch(() => undefined);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.postCard,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <View style={styles.postHeader}>
                        <Text style={styles.postHandle}>@{post.handle}</Text>
                        <Ionicons name="open-outline" size={13} color={palette.textDim} />
                      </View>
                      <Text style={styles.postText}>{post.text}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Read full story */}
          <Pressable
            onPress={openSource}
            style={({ pressed }) => [styles.readBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="open-outline" size={18} color={palette.text} />
            <Text style={styles.readBtnText} numberOfLines={1}>
              Read full story at {displaySource}
            </Text>
          </Pressable>

          {/* Up next */}
          {nextStory ? (
            <View style={styles.next}>
              <Text style={styles.nextLabel}>Up next</Text>
              <Pressable
                onPress={openNext}
                style={({ pressed }) => [styles.nextCard, { opacity: pressed ? 0.8 : 1 }]}
              >
                <StoryImage
                  uri={nextStory.media_url}
                  category={nextStory.category}
                  style={styles.nextThumb}
                />
                <View style={styles.nextText}>
                  <View style={styles.nextChip}>
                    {nextMeta ? (
                      <Ionicons
                        name={CATEGORY_ICONS[nextMeta.icon]}
                        size={13}
                        color={nextMeta.color}
                      />
                    ) : null}
                    <Text
                      style={[styles.nextChipText, { color: nextMeta?.color ?? palette.accent }]}
                      numberOfLines={1}
                    >
                      {nextMeta ? `${nextMeta.label} · ` : ""}
                      {sourceDomain(nextStory.source_url)}
                    </Text>
                  </View>
                  <Text style={styles.nextTitle} numberOfLines={3}>
                    {nextStory.display_title || nextStory.title}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={palette.textDim} />
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      </Animated.ScrollView>

      {/* Compact title bar: fades in once the sheet reaches the top */}
      <Animated.View
        pointerEvents="none"
        style={[styles.bar, { height: barH, paddingTop: insets.top }, barStyle]}
      >
        <BlurView
          intensity={40}
          tint={isDark ? "dark" : "light"}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.bg + "CC" }]} />
        <Animated.Text style={[styles.barTitle, barTitleStyle]} numberOfLines={1}>
          {title}
        </Animated.Text>
      </Animated.View>

      {/* Floating glass controls */}
      <View
        pointerEvents="box-none"
        style={[styles.topRow, { top: insets.top + 8, left: hPad - 4, right: hPad - 4 }]}
      >
        <GlassButton isDark={isDark} onPress={goBack} label="Back">
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </GlassButton>
        <View style={{ flex: 1 }} />
        {canSaveStories(!!user) ? (
          <GlassButton isDark={isDark}>
            <SaveButton story={story} size={20} color="#fff" />
          </GlassButton>
        ) : null}
        <GlassButton isDark={isDark} onPress={share} label="Share">
          <Ionicons name="share-outline" size={20} color="#fff" />
        </GlassButton>
      </View>

      <DetachedTabBar />
    </View>
  );
}

/** 44pt frosted circle that floats over the hero. Without onPress it just frames its child (e.g. SaveButton). */
function GlassButton({
  children,
  onPress,
  label,
  isDark,
}: {
  children: ReactNode;
  onPress?: () => void;
  label?: string;
  isDark: boolean;
}) {
  const body = (
    <>
      <BlurView
        intensity={45}
        tint={isDark ? "dark" : "light"}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(22,30,46,0.62)" }]} />
      {children}
    </>
  );
  if (!onPress) return <View style={glass.btn}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [glass.btn, { opacity: pressed ? 0.75 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

const glass = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
});

function daysRemaining(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  return days > 0 ? days : 0;
}

function pctChange(start?: number, end?: number): string {
  if (!start || !end) return "0.00";
  return (((end - start) / start) * 100).toFixed(2);
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: palette.bg },
    scrollView: { flex: 1 },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.bg,
    },
    hero: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      overflow: "hidden",
      backgroundColor: palette.surfaceHigh,
    },
    heroScrim: { position: "absolute", top: 0, left: 0 },
    sheet: {
      minHeight: Dimensions.get("window").height - TOP_ROW_H,
      gap: 18,
      paddingTop: 12,
      backgroundColor: palette.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderTopWidth: 1,
      borderColor: "rgba(255,255,255,0.08)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -24 },
      shadowOpacity: 0.4,
      shadowRadius: 24,
    },
    grab: {
      width: 38,
      height: 5,
      borderRadius: 3,
      backgroundColor: palette.text + "29",
      alignSelf: "center",
    },
    tagsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    leftPill: {
      height: 32,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: palette.surface + "B8",
      borderWidth: 1,
      borderColor: palette.border,
    },
    leftPillUrgent: {
      backgroundColor: "#EF444418",
      borderColor: "#EF444440",
    },
    leftPillText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: palette.textMuted,
    },
    leftPillTextUrgent: { color: "#EF4444" },
    playBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: palette.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    // Halo ring while this story is playing.
    playBtnOn: {
      shadowColor: palette.accent,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.6,
      shadowRadius: 10,
      elevation: 8,
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 30,
      lineHeight: 34,
      color: palette.text,
      letterSpacing: -0.55,
    },
    meta: {
      marginTop: -6,
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: palette.textMuted,
    },
    metaSource: { fontFamily: "Inter_600SemiBold", color: palette.text },
    summary: {
      marginTop: 4,
      fontFamily: "Inter_400Regular",
      fontSize: 19,
      lineHeight: 31,
      color: palette.text,
    },
    insightCard: {
      backgroundColor: palette.bgElevated,
      borderRadius: 16,
      padding: 16,
      gap: 8,
      borderWidth: 1,
      borderColor: palette.border,
    },
    impactCard: {
      borderColor: "#7B68EE44",
      backgroundColor: "#7B68EE0A",
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
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    sectionLabel: {
      fontFamily: "Inter_700Bold",
      fontSize: 12,
      color: palette.accent,
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    xLogo: { fontSize: 14, fontWeight: "900", color: "#1DA1F2", lineHeight: 18 },
    impactText: {
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      lineHeight: 22,
      color: palette.text,
    },
    stockCard: {
      backgroundColor: palette.bgElevated,
      borderRadius: 16,
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
      borderRadius: 999,
      alignItems: "center",
      borderWidth: 1,
    },
    rangeTabLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
    chartPlaceholder: {
      height: 160,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.bg,
      borderRadius: 12,
    },
    chartEmpty: { fontFamily: "Inter_500Medium", color: palette.textDim, fontSize: 13 },
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
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 16,
      backgroundColor: palette.bgElevated,
      borderWidth: 1,
      borderColor: palette.border,
    },
    noTickerText: {
      fontFamily: "Inter_500Medium",
      fontSize: 14,
      color: palette.textMuted,
      flex: 1,
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
    postsList: { gap: 8, marginTop: 4 },
    postCard: {
      backgroundColor: palette.bg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#1DA1F222",
      padding: 12,
      gap: 4,
    },
    postHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    postHandle: { fontFamily: "Inter_700Bold", fontSize: 12, color: "#1DA1F2" },
    postText: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: palette.text,
    },
    readBtn: {
      height: 54,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      paddingHorizontal: 20,
      borderRadius: 999,
      backgroundColor: palette.surface + "B8",
      borderWidth: 1,
      borderColor: palette.borderStrong,
    },
    readBtnText: {
      fontFamily: "Inter_700Bold",
      fontSize: 15.5,
      color: palette.text,
      flexShrink: 1,
    },
    next: {
      marginTop: 12,
      paddingTop: 22,
      gap: 12,
      borderTopWidth: 1,
      borderTopColor: palette.divider,
    },
    nextLabel: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: palette.textMuted,
    },
    nextCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 10,
      borderRadius: 22,
      backgroundColor: palette.bgElevated,
      borderWidth: 1,
      borderColor: palette.border,
    },
    nextThumb: { width: 88, height: 88, borderRadius: 15 },
    nextText: { flex: 1, minWidth: 0, gap: 6 },
    nextChip: { flexDirection: "row", alignItems: "center", gap: 5 },
    nextChipText: { fontFamily: "Inter_700Bold", fontSize: 12.5, flexShrink: 1 },
    nextTitle: {
      fontFamily: "Inter_700Bold",
      fontSize: 16.5,
      lineHeight: 21,
      color: palette.text,
    },
    bar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      overflow: "hidden",
      justifyContent: "center",
      paddingLeft: 72,
      paddingRight: 124,
      borderBottomWidth: 1,
      borderBottomColor: palette.divider,
    },
    barTitle: {
      fontFamily: "Inter_700Bold",
      fontSize: 15,
      color: palette.text,
    },
    topRow: {
      position: "absolute",
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
  });
}
