import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  FadeInDown,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  useAnimatedReaction,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
  ScrollView as GHScrollView,
} from "react-native-gesture-handler";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useGetStockHistory,
  useGetStory,
  useListStories,
  type Story,
} from "@workspace/api-client-react";
import { CATEGORY_ICONS, getCategoryMeta } from "@/constants/categories";
import StoryImage from "@/components/StoryImage";
import { useAudio, useAudioProgress } from "@/contexts/AudioContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import {
  isPersonalizationActive,
  scoreStory,
  usePersonalization,
} from "@/lib/personalization";
import { useAuth } from "@/contexts/AuthContext";
import { canSaveStories } from "@/constants/features";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";
import CategoryBadge from "@/components/CategoryBadge";
import PhotoCredit from "@/components/PhotoCredit";
import PriceChart from "@/components/PriceChart";
import SaveButton from "@/components/SaveButton";
import EmptyState from "@/components/EmptyState";
import WaveBars from "@/components/player/WaveBars";
import { DetachedTabBar } from "@/components/GlassTabBar";
import {
  NAV,
  useChromeBottomPadding,
  useNavChrome,
  useTabBarBottom,
} from "@/contexts/NavChromeContext";
import { useIsDesktop } from "@/hooks/useLayoutMode";
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

const AnimatedGHScrollView = Animated.createAnimatedComponent(GHScrollView);

/**
 * Mobile fills the screen; desktop web floats the same story view in a
 * centred panel over the dimmed feed. `sheetTop` is how much hero shows
 * above the sheet before scrolling; the hero runs `heroH` tall so its extra
 * sits under the sheet's rounded corners.
 */
const MOBILE = { sheetTop: 350, heroH: 410, topRowH: 60 };
const DESKTOP_PANEL = { sheetTop: 320, heroH: 390, topRowH: 76, maxW: 760, margin: 24, hPad: 52 };

export default function StoryDetailScreen() {
  const { theme: palette, isDark } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { user } = useAuth();
  const { saved } = useSavedStories();
  const { prefs: personalizationPrefs } = usePersonalization();
  const [stockRange, setStockRange] = useState<StockRange>("1d");
  const { story: audioStory, isPlaying, isAudioLoading, playStory, togglePlayPause } =
    useAudio();
  const { isCollapsed, setCollapsed } = useNavChrome();
  const chromeBottomPad = useChromeBottomPadding();
  // The nav sits collapsed here (one button + the mini player beside it), so
  // the Up next peek only needs to clear that single row.
  const peekBottomPad = useTabBarBottom() + NAV.tabH + 20;
  const isDesktop = useIsDesktop();
  const { width: winW, height: winH } = useWindowDimensions();

  const panelW = Math.min(DESKTOP_PANEL.maxW, winW - DESKTOP_PANEL.margin * 2);
  const L = isDesktop
    ? {
        sheetTop: DESKTOP_PANEL.sheetTop,
        heroH: DESKTOP_PANEL.heroH,
        barH: DESKTOP_PANEL.topRowH,
        controlsTop: 16,
        hPad: DESKTOP_PANEL.hPad,
        width: panelW,
        height: winH - DESKTOP_PANEL.margin * 2,
        bottomPad: 190, // clears the docked audio bar
      }
    : {
        sheetTop: MOBILE.sheetTop,
        heroH: MOBILE.heroH,
        barH: insets.top + MOBILE.topRowH,
        controlsTop: insets.top + 8,
        hPad: Math.max(20, insets.left + 4),
        width: winW,
        height: winH,
        bottomPad: chromeBottomPad,
      };
  const { sheetTop, heroH, barH } = L;

  // On mobile the nav stays tucked into its single button so the story gets
  // the room; hand it back expanded on the way out. Desktop never tucks it.
  useEffect(() => {
    if (isDesktop) return;
    setCollapsed(true);
    return () => setCollapsed(false);
  }, [isDesktop, setCollapsed]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // Esc closes the desktop panel, as on the design's other overlays.
  useEffect(() => {
    if (!isDesktop || Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop]);

  // Same query the unfiltered feed uses, so "Up next" is usually a cache hit.
  const feed = useListStories(undefined, {
    query: { staleTime: 60_000 } as any,
  });

  // Saved or feed copy shows instantly while the full story loads, which is
  // what lets the Up next swap land without a loading flash.
  const localFallback =
    saved.find((s) => s.id === id) ??
    (feed.data?.stories as Story[] | undefined)?.find((s) => s.id === id) ??
    null;

  const { data, isLoading, error } = useGetStory(id ?? "", {
    query: {
      enabled: !!id,
      placeholderData: localFallback ?? undefined,
    } as any,
  });

  const story: Story | null = (data as Story | undefined) ?? localFallback;

  // Up Next follows the list the user opened this story from, carried in
  // the `from` route param: a category tab chains through that category
  // in tab order and ends there (no wrap), "all" loops the whole feed
  // continuously, "feed" loops the personalized ranking, and "saved"
  // chains through the saved stories. Entries with no list context
  // (search, the player, shared links) fall back to the story's own
  // category.
  const upNextContext = useMemo(() => {
    const byPublishedDesc = (a: Story, b: Story) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    };
    const feedList: Story[] = [
      ...((feed.data?.stories as Story[] | undefined) ?? []),
    ].sort(byPublishedDesc);
    if (from === "saved")
      return { list: saved, loop: false, label: "your saved stories" as string | null };
    if (from === "all") return { list: feedList, loop: true, label: null as string | null };
    if (from === "feed") {
      // The Feed chaining order is the feed's personalized ranking.
      const ranked = isPersonalizationActive(personalizationPrefs)
        ? feedList
            .map((s, i) => ({ s, i, score: scoreStory(s, personalizationPrefs) }))
            .sort((a, b) => b.score - a.score || a.i - b.i)
            .map((x) => x.s)
        : feedList;
      return { list: ranked, loop: true, label: null as string | null };
    }
    const catKey = from && getCategoryMeta(from) ? from : (story?.category ?? null);
    if (catKey) {
      return {
        list: feedList.filter((s) => s.category === catKey),
        loop: false,
        label: (getCategoryMeta(catKey)?.label ?? catKey) as string | null,
      };
    }
    return { list: feedList, loop: true, label: null as string | null };
  }, [from, feed.data, saved, story?.category, personalizationPrefs]);

  const nextStory = useMemo(() => {
    const list = upNextContext.list;
    if (!story || list.length < 2) return null;
    const idx = list.findIndex((s) => s.id === story.id);
    if (idx === -1) return upNextContext.loop ? list[0] : null;
    if (idx + 1 < list.length) return list[idx + 1];
    return upNextContext.loop ? list[0] : null;
  }, [upNextContext, story?.id]);

  // End of a non-looping list: the Up Next slot shows an "all caught up"
  // note instead of silently disappearing.
  const caughtUp =
    !!story &&
    !nextStory &&
    !upNextContext.loop &&
    upNextContext.list.some((s) => s.id === story.id);
  // The drag-up peek leans on native gesture handling, so it's iOS only;
  // web and Android get the Up next card.
  const hasPeek = Platform.OS === "ios" && !isDesktop && !!nextStory;

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
  // Set to the page's resting scroll offset when a pull past the bottom
  // should carry on into the next story; the peek reacts to it.
  const pullPast = useSharedValue(-1);
  const scrollRef = useRef<any>(null);
  const scrollGesture = useMemo(() => Gesture.Native(), []);

  // Up next swaps the story in place: start the new one at the top.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
    scrollY.value = 0;
    pullPast.value = -1;
  }, [id, scrollY]);
  const navOpen = useSharedValue(false);
  useEffect(() => {
    navOpen.value = !isCollapsed;
  }, [isCollapsed, navOpen]);
  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        const y = e.contentOffset.y;
        if (!isDesktop && navOpen.value && y > scrollY.value + 6) {
          navOpen.value = false;
          runOnJS(setCollapsed)(true);
        }
        scrollY.value = y;
      },
      // iOS: letting go well past the bottom (into the bounce) moves on to
      // the next story, same as dragging the peek up.
      onEndDrag: (e) => {
        if (!hasPeek) return;
        const maxY = e.contentSize.height - e.layoutMeasurement.height;
        if (e.contentOffset.y - maxY > PULL_TO_NEXT) pullPast.value = Math.max(0, maxY);
      },
    },
    [isDesktop, hasPeek]
  );
  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    const scale = y < 0 ? 1 + -y / heroH : 1;
    // Scale grows about the centre; shift down so the top edge stays pinned.
    const pin = (heroH * (scale - 1)) / 2;
    return {
      transform: [{ translateY: (y > 0 ? -y * 0.4 : 0) + pin }, { scale }],
    };
  });
  const shadeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(0.75, (Math.max(0, scrollY.value) / sheetTop) * 0.75),
  }));
  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [sheetTop - barH - 40, sheetTop - barH],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));
  const barTitleStyle = useAnimatedStyle(() => {
    const o = interpolate(
      scrollY.value,
      [sheetTop + 90, sheetTop + 130],
      [0, 1],
      Extrapolation.CLAMP
    );
    return { opacity: o, transform: [{ translateY: (1 - o) * 8 }] };
  });

  const hPad = L.hPad;
  const chartWidth = L.width - hPad * 2 - 32;

  // Desktop: scrim over the feed (click to close) with the story in a panel.
  // The nav and mini player step aside there; the panel's audio bar stands in.
  const frame = (children: ReactNode) =>
    isDesktop ? (
      <View style={styles.desktopRoot}>
        <Pressable
          style={styles.scrim}
          onPress={goBack}
          accessibilityLabel="Close story"
        />
        <Animated.View
          entering={FadeInDown.duration(450)}
          style={[styles.panel, { width: L.width, height: L.height }]}
        >
          {children}
          {story ? <PanelAudioBar story={story} /> : null}
        </Animated.View>
      </View>
    ) : (
      <View style={styles.container}>
        {children}
        <DetachedTabBar />
      </View>
    );

  if (isLoading && !story) {
    return frame(
      <View style={styles.center}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (!story) {
    return frame(
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
    // Desktop swaps the panel's story in place rather than stacking panels.
    // The `from` context rides along so the Up Next chain stays in the
    // list the user started from.
    const next = {
      pathname: "/story/[id]" as const,
      params: { id: nextStory.id, ...(from ? { from } : {}) },
    };
    if (isDesktop) router.replace(next);
    else router.push(next);
  };

  // The mobile peek has already animated into place; swap the story under it.
  const openNextInPlace = () => {
    if (nextStory) router.setParams({ id: nextStory.id });
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

  return frame(
    <>
      {/* Hero: fixed behind the scroll view, parallaxes up and dims as the sheet covers it */}
      <Animated.View style={[styles.hero, { height: heroH }, heroStyle]}>
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

      <GestureDetector gesture={scrollGesture}>
        <AnimatedGHScrollView
          ref={scrollRef}
          style={styles.scrollView}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: hasPeek ? 0 : L.bottomPad }}
          showsVerticalScrollIndicator={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
        >
          {/* Transparent window onto the hero. The credit lives here (not on
              the hero) so it stays tappable above the scroll view. */}
          <View style={{ height: sheetTop }} pointerEvents="box-none">
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
            style={[
              styles.sheet,
              isDesktop && styles.sheetDesktop,
              { paddingHorizontal: hPad, minHeight: L.height - barH },
              hasPeek && styles.sheetWithPeek,
            ]}
          >
            {isDesktop ? null : <View style={styles.grab} />}

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

            <Text style={[styles.title, isDesktop && styles.titleDesktop]}>{title}</Text>

            <Text style={styles.meta}>
              <Text style={styles.metaSource}>{displaySource}</Text>
              {story.published_at
                ? `  ·  ${formatRelativeTime(story.published_at)}  ·  ${formatDateTime(story.published_at)}`
                : ""}
            </Text>

            <Text style={[styles.summary, isDesktop && styles.summaryDesktop]}>{story.summary ?? story.one_liner}</Text>

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

            {/* Up next card (iOS gets the peek below the sheet instead) */}
            {nextStory && !hasPeek ? (
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

            {/* End of a category / saved list: no Up Next, just the note */}
            {caughtUp && !hasPeek ? (
              <View style={styles.next}>
                <Text style={styles.nextLabel}>Up next</Text>
                <View style={styles.caughtUpCard}>
                  <Ionicons name="checkmark-circle" size={20} color={palette.accent} />
                  <Text style={styles.caughtUpText}>
                    All caught up{upNextContext.label ? ` in ${upNextContext.label}` : ""}
                  </Text>
                </View>
              </View>
            ) : null}
          </Animated.View>

          {hasPeek ? (
            <UpNextPeek
              key={nextStory.id}
              next={nextStory}
              scrollY={scrollY}
              sheetTop={sheetTop}
              hPad={hPad}
              bottomPad={peekBottomPad}
              scrollGesture={scrollGesture}
              pullPast={pullPast}
              onOpen={openNextInPlace}
            />
          ) : null}
        </AnimatedGHScrollView>
      </GestureDetector>

      {/* Compact title bar: fades in once the sheet reaches the top */}
      <Animated.View
        pointerEvents="none"
        style={[styles.bar, { height: barH, paddingTop: barH - MOBILE.topRowH }, barStyle]}
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
        style={[
          styles.topRow,
          isDesktop
            ? { top: L.controlsTop, left: 16, right: 16 }
            : { top: L.controlsTop, left: hPad - 4, right: hPad - 4 },
        ]}
      >
        <GlassButton
          isDark={isDark}
          onPress={goBack}
          label={isDesktop ? "Close (Esc)" : "Back"}
        >
          <Ionicons name={isDesktop ? "close" : "arrow-back"} size={22} color="#fff" />
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
    </>
  );
}

const PEEK_IMG_H = 128;
/** How far past the bottom (pt) an iOS overscroll must be released to move on. */
const PULL_TO_NEXT = 80;
const PEEK_EASE = Easing.bezier(0.2, 0.9, 0.25, 1);

/**
 * Mobile "Up next": the next story's sheet peeks in below this one. Drag it
 * up (or tap it) and it rides to the top of the screen while its image grows
 * into a full hero, then the screen swaps to that story in place — the peek
 * ends exactly where the next story's hero and sheet sit, so the swap is
 * seamless. A short or slow drag springs back.
 */
function UpNextPeek({
  next,
  scrollY,
  sheetTop,
  hPad,
  bottomPad,
  scrollGesture,
  pullPast,
  onOpen,
}: {
  next: Story;
  scrollY: SharedValue<number>;
  sheetTop: number;
  hPad: number;
  bottomPad: number;
  scrollGesture: ReturnType<typeof Gesture.Native>;
  /** Page scroll offset to land against once a pull past the bottom commits; -1 when idle. */
  pullPast: SharedValue<number>;
  onOpen: () => void;
}) {
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const dd = useSharedValue(0);
  const top0 = useSharedValue(600);
  const peekY = useSharedValue(0);
  const busy = useSharedValue(false);
  const bob = useSharedValue(0);
  useEffect(() => {
    bob.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [bob]);

  // The parent re-renders often (nav collapse, audio state); route the
  // hand-over through a ref so the gestures below can stay stable — rebuilding
  // them mid-drag would drop the drag.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const { gesture, commit } = useMemo(() => {
    const haptic = () =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const handOver = () => onOpenRef.current();

    // Ride the peek up to the top of the viewport, then hand over. `restY`
    // is where the page scroll will sit when the ride ends.
    const commit = (restY: number) => {
      "worklet";
      busy.value = true;
      top0.value = Math.max(1, peekY.value - restY);
      runOnJS(haptic)();
      dd.value = withTiming(
        -(peekY.value - restY),
        { duration: 400, easing: PEEK_EASE },
        (finished) => {
          if (finished) runOnJS(handOver)();
        }
      );
    };

    const tap = Gesture.Tap().onEnd((_e, success) => {
      if (!success || busy.value) return;
      commit(scrollY.value);
    });

    // Owns vertical drags that start on the peek, so the page doesn't scroll
    // underneath; dragging down only gives a little.
    const pan = Gesture.Pan()
      .activeOffsetY([-6, 6])
      .blocksExternalGesture(scrollGesture)
      .onStart(() => {
        top0.value = Math.max(1, peekY.value - scrollY.value);
      })
      .onUpdate((e) => {
        if (busy.value) return;
        dd.value = e.translationY < 0 ? e.translationY : e.translationY * 0.25;
      })
      .onEnd((e) => {
        if (busy.value) return;
        if (-dd.value > 110 || e.velocityY < -600) commit(scrollY.value);
        else dd.value = withTiming(0, { duration: 450, easing: PEEK_EASE });
      });

    return { gesture: Gesture.Exclusive(pan, tap), commit };
  }, [scrollGesture, scrollY, dd, top0, peekY, busy]);

  // The page was pulled past its bottom: the bounce settles the scroll at
  // `pullPast`, so ride against that rather than the overscrolled offset.
  useAnimatedReaction(
    () => pullPast.value,
    (restY, prev) => {
      if (restY >= 0 && restY !== prev && !busy.value) commit(restY);
    },
    [commit]
  );

  const wrapStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dd.value }] }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, 1 + dd.value / 80)),
  }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: 1 - bob.value * 3 }],
  }));
  const imgStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, -dd.value / top0.value));
    return { height: PEEK_IMG_H + (sheetTop + 28 - PEEK_IMG_H) * p };
  });
  const previewStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, -dd.value / 160)),
    transform: [{ translateY: Math.max(0, 24 + dd.value / 6) }],
  }));

  const days = daysRemaining(next.expires_at);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.peek, wrapStyle]}
        onLayout={(e) => {
          peekY.value = e.nativeEvent.layout.y;
        }}
        accessibilityRole="button"
        accessibilityLabel={`Up next: ${next.display_title || next.title}`}
      >
        <Svg style={styles.peekFade} width="100%" height={56} pointerEvents="none">
          <Defs>
            <LinearGradient id="peek-fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#05070B" stopOpacity={0} />
              <Stop offset="1" stopColor="#05070B" stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#peek-fade)" />
        </Svg>

        <Animated.View style={[styles.peekLabel, labelStyle]} pointerEvents="none">
          <Animated.View style={chevronStyle}>
            <Ionicons name="chevron-up" size={15} color={palette.text} />
          </Animated.View>
          <Text style={styles.peekLabelText}>Up next</Text>
        </Animated.View>

        <Animated.View style={[styles.peekImg, imgStyle]}>
          <StoryImage uri={next.media_url} category={next.category} style={StyleSheet.absoluteFill} />
        </Animated.View>

        <View style={[styles.peekBody, { paddingHorizontal: hPad, paddingBottom: bottomPad }]}>
          <View style={styles.grab} />
          <View style={styles.peekHead}>
            <View style={styles.tagsRow}>
              <CategoryBadge category={next.category} size="lg" />
              {days !== null ? (
                <View style={styles.leftPill}>
                  <Ionicons name="time-outline" size={13} color={palette.textMuted} />
                  <Text style={styles.leftPillText}>
                    {days === 0 ? "Expires today" : `${days}d left`}
                  </Text>
                </View>
              ) : null}
              <View style={{ flex: 1 }} />
              <View style={[styles.playBtn, { backgroundColor: palette.accent + "2E" }]}>
                <Ionicons name="play" size={18} color={palette.accent} style={{ marginLeft: 2 }} />
              </View>
            </View>
            <Text style={styles.title}>{next.display_title || next.title}</Text>
            <Text style={styles.meta}>
              <Text style={styles.metaSource}>{sourceDomain(next.source_url)}</Text>
              {next.published_at
                ? `  ·  ${formatRelativeTime(next.published_at)}  ·  ${formatDateTime(next.published_at)}`
                : ""}
            </Text>

            {/* A glimpse of the body that fades in as the peek is dragged up */}
            <Animated.View style={[styles.peekPreview, previewStyle]} pointerEvents="none">
              <Text style={styles.summary}>{next.summary ?? next.one_liner}</Text>
              <View style={styles.readBtn}>
                <Ionicons name="open-outline" size={18} color={palette.text} />
                <Text style={styles.readBtnText} numberOfLines={1}>
                  Read full story at {sourceDomain(next.source_url)}
                </Text>
              </View>
            </Animated.View>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Desktop panel's audio bar: the feed's glass mini player, docked to the
 * panel's bottom edge while the real one steps aside. It shows whatever is
 * playing, or offers this story when nothing is. Kept separate so progress
 * ticks only re-render the bar.
 */
function PanelAudioBar({ story }: { story: Story }) {
  const { theme: palette, isDark } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const {
    story: audioStory,
    isPlaying,
    isAudioLoading,
    isBarVisible,
    queue,
    playStory,
    togglePlayPause,
    seekTo,
  } = useAudio();
  const { positionMs, durationMs } = useAudioProgress();
  const { isQueueOpen, setQueueOpen } = useNavChrome();
  const [railW, setRailW] = useState(0);

  const loaded = isBarVisible && !!audioStory;
  const shown = loaded ? audioStory : story;
  const meta = getCategoryMeta(shown.category);
  const catColor = meta?.color ?? palette.accent;
  const playing = loaded && isPlaying;
  const progress = loaded && durationMs > 0 ? Math.min(positionMs / durationMs, 1) : 0;

  const onPlay = () => {
    if (loaded) togglePlayPause().catch(() => undefined);
    else playStory(story).catch(() => undefined);
  };
  const seekAt = (x: number) => {
    if (!loaded || durationMs <= 0 || railW <= 0) return;
    seekTo(Math.max(0, Math.min(1, x / railW)) * durationMs).catch(() => undefined);
  };

  return (
    <View style={styles.audioDock} pointerEvents="box-none">
      <View style={styles.audioBar}>
        <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.bgElevated + (isDark ? "BD" : "CC") }]}
        />
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
          <Defs>
            <RadialGradient id="pab-glow" cx="12%" cy="50%" rx="55%" ry="140%">
              <Stop offset="0" stopColor={catColor} stopOpacity={isDark ? 0.22 : 0.14} />
              <Stop offset="1" stopColor={catColor} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#pab-glow)" />
        </Svg>

        <View style={styles.audioArt}>
          <StoryImage uri={shown.media_url} category={shown.category} style={StyleSheet.absoluteFill} />
          <View style={styles.audioArtScrim}>
            <WaveBars isPlaying={playing} color="#fff" />
          </View>
        </View>

        <View style={styles.audioTitle}>
          <Text style={styles.audioTitleText} numberOfLines={1}>
            {loaded ? shown.display_title || shown.title : "Listen to this story"}
          </Text>
          <Text style={styles.audioMeta} numberOfLines={1}>
            <Text style={{ color: catColor }}>{meta?.label ?? ""}</Text>
            {loaded && durationMs > 0
              ? ` · ${formatMs(positionMs)} / ${formatMs(durationMs)}`
              : loaded && audioStory.id !== story.id
                ? " · Now playing"
                : ""}
          </Text>
        </View>

        <Pressable
          onPress={onPlay}
          disabled={isAudioLoading}
          accessibilityLabel={playing ? "Pause" : "Play"}
          style={({ hovered, pressed }) => [
            styles.audioPlay,
            { transform: [{ scale: pressed ? 0.95 : hovered ? 1.06 : 1 }] },
          ]}
        >
          {isAudioLoading ? (
            <ActivityIndicator size="small" color={palette.bg} />
          ) : (
            <Ionicons
              name={playing ? "pause" : "play"}
              size={16}
              color={palette.bg}
              style={playing ? undefined : { marginLeft: 2 }}
            />
          )}
        </Pressable>

        <Pressable
          onPress={() => setQueueOpen(!isQueueOpen)}
          accessibilityLabel="Queue"
          style={({ hovered }) => [
            styles.audioQueue,
            isQueueOpen
              ? { backgroundColor: palette.warning + "29" }
              : hovered
                ? { backgroundColor: palette.text + "14" }
                : null,
          ]}
        >
          <Ionicons name="list" size={20} color={isQueueOpen ? palette.warning : palette.textMuted} />
          {queue.length > 0 ? (
            <Text
              style={[styles.audioQueueCount, { color: isQueueOpen ? palette.warning : palette.textMuted }]}
            >
              {queue.length}
            </Text>
          ) : null}
        </Pressable>

        {/* Thin progress line along the bottom edge; click it to seek. */}
        <Pressable
          style={styles.audioRailHit}
          onLayout={(e) => setRailW(e.nativeEvent.layout.width)}
          onPress={(e) => seekAt(e.nativeEvent.locationX)}
          accessibilityLabel="Seek"
        >
          <View style={styles.audioRail}>
            <View style={[styles.audioFill, { width: `${progress * 100}%` }]} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
    desktopRoot: { flex: 1, backgroundColor: "transparent" },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(5,7,11,0.62)",
      ...(Platform.OS === "web" ? ({ backdropFilter: "blur(8px)", cursor: "default" } as object) : null),
    },
    panel: {
      position: "absolute",
      top: DESKTOP_PANEL.margin,
      alignSelf: "center",
      overflow: "hidden",
      borderRadius: 28,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.09)",
      backgroundColor: palette.bg,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 30 },
      shadowOpacity: 0.6,
      shadowRadius: 40,
    },
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
    sheetDesktop: { paddingTop: 30, gap: 20 },
    // With the peek following, the sheet ends at its content plus room for the fade.
    sheetWithPeek: { minHeight: 0, paddingBottom: 56 },
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
    titleDesktop: { fontSize: 38, lineHeight: 43, letterSpacing: -0.7 },
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
    summaryDesktop: { fontSize: 20, lineHeight: 32 },
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
    caughtUpCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 16,
      borderRadius: 22,
      backgroundColor: palette.bgElevated,
      borderWidth: 1,
      borderColor: palette.border,
    },
    caughtUpText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: palette.text,
      flexShrink: 1,
    },
    nextText: { flex: 1, minWidth: 0, gap: 6 },
    nextChip: { flexDirection: "row", alignItems: "center", gap: 5 },
    nextChipText: { fontFamily: "Inter_700Bold", fontSize: 12.5, flexShrink: 1 },
    nextTitle: {
      fontFamily: "Inter_700Bold",
      fontSize: 16.5,
      lineHeight: 21,
      color: palette.text,
    },
    peek: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -24 },
      shadowOpacity: 0.55,
      shadowRadius: 24,
    },
    peekFade: { position: "absolute", top: -56, left: 0 },
    peekLabel: {
      position: "absolute",
      top: -42,
      alignSelf: "center",
      zIndex: 1,
      height: 30,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: 11,
      paddingRight: 14,
      borderRadius: 999,
      backgroundColor: "rgba(22,30,46,0.8)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.12)",
    },
    peekLabelText: { fontFamily: "Inter_700Bold", fontSize: 12.5, color: palette.text },
    peekImg: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      overflow: "hidden",
      borderTopWidth: 1,
      borderColor: "rgba(255,255,255,0.14)",
      backgroundColor: palette.surfaceHigh,
    },
    peekBody: {
      marginTop: -28,
      paddingTop: 12,
      gap: 18,
      backgroundColor: palette.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderTopWidth: 1,
      borderColor: "rgba(255,255,255,0.08)",
    },
    peekHead: { gap: 18 },
    peekPreview: { position: "absolute", left: 0, right: 0, top: "100%", marginTop: 18, gap: 18 },
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
    // Matches the desktop mini player bar (components/player/DesktopPlayer).
    audioDock: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 16,
      alignItems: "center",
    },
    audioBar: {
      width: "100%",
      maxWidth: 460,
      height: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 10,
      paddingRight: 10,
      borderRadius: 32,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: palette.borderStrong + "AA",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.5,
      shadowRadius: 40,
    },
    audioArt: {
      width: 44,
      height: 44,
      borderRadius: 11,
      overflow: "hidden",
      marginRight: 2,
      backgroundColor: palette.surfaceHigh,
    },
    audioArtScrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    audioTitle: { flex: 1, minWidth: 0, gap: 2 },
    audioTitleText: { fontFamily: "Inter_600SemiBold", fontSize: 14.5, color: palette.text },
    audioMeta: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: palette.textMuted,
      fontVariant: ["tabular-nums"],
    },
    audioPlay: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: palette.text,
      alignItems: "center",
      justifyContent: "center",
    },
    audioQueue: {
      height: 34,
      paddingHorizontal: 12,
      borderRadius: 17,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    audioQueueCount: { fontFamily: "Inter_700Bold", fontSize: 13 },
    audioRailHit: {
      position: "absolute",
      left: 32,
      right: 32,
      bottom: 0,
      height: 8,
      justifyContent: "flex-end",
      ...(Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null),
    },
    audioRail: { height: 2, backgroundColor: palette.text + "14" },
    audioFill: { height: "100%", backgroundColor: palette.accent, borderRadius: 1 },
    topRow: {
      position: "absolute",
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
  });
}
