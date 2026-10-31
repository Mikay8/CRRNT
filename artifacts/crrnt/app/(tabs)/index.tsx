import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { router } from "expo-router";
import {
  useListStories,
  type Story,
} from "@workspace/api-client-react";
import StoryCard from "@/components/StoryCard";
import CategoryFilter from "@/components/CategoryFilter";
import EmptyState from "@/components/EmptyState";
import type { FeedSelection } from "@/constants/categories";
import { AUTH_ENABLED } from "@/constants/features";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import type { ThemeColors } from "@/constants/theme";
import { useChromeBottomPadding, useNavChrome } from "@/contexts/NavChromeContext";
import DesktopHeader from "@/components/DesktopHeader";
import StoryGrid from "@/components/StoryGrid";
import { useIsDesktop } from "@/hooks/useLayoutMode";
import {
  isPersonalizationActive,
  personalizedFeed,
  usePersonalization,
} from "@/lib/personalization";
import {
  finishedOn,
  isDayComplete,
  recordFeedCompletion,
  todayStr,
  useStreaks,
} from "@/lib/streaks";
import { reportScroll } from "@/hooks/useFastScroll";

const LOGO_DARK = require("@/assets/images/full-logo-dark.png") as number;
const LOGO_LIGHT = require("@/assets/images/full-logo-light.png") as number;

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { isDark, theme: palette } = useThemeContext();
  const { user, accessToken } = useAuth();
  const isGuest = !user;
  // Mobile defaults to the personalized Feed view; web keeps the
  // plain All feed (no Feed pill there either). Users without active
  // personalization fall back to All below — they never see Feed.
  const [category, setCategory] = useState<FeedSelection>(() =>
    Platform.OS !== "web" ? "feed" : null,
  );

  const styles = useMemo(() => createStyles(palette), [palette]);
  const { onFeedScroll } = useNavChrome();
  const bottomPad = useChromeBottomPadding();
  const isDesktop = useIsDesktop();
  const [headerMini, setHeaderMini] = useState(false);
  const [desktopHeadH, setDesktopHeadH] = useState(200);
  const lastY = useRef(0);

  const { data, isLoading, isFetching, refetch, error } = useListStories(
    category && category !== "feed" ? { category } : undefined,
    { query: { staleTime: 60_000 } as any }
  );

  const rawStories: Story[] = data?.stories ?? [];

  const { prefs: personalizationPrefs, loaded: personalizationLoaded } =
    usePersonalization();
  const personalizationActive = isPersonalizationActive(personalizationPrefs);
  // The Feed tab exists only for users who answered the quiz: skipped
  // or turned-off users never see it. If personalization goes away
  // while Feed is selected (turned off in Settings), fall back to All.
  const showFeedTab = Platform.OS !== "web" && personalizationActive;
  useEffect(() => {
    if (
      personalizationLoaded &&
      !personalizationActive &&
      category === "feed"
    ) {
      setCategory(null);
    }
  }, [personalizationLoaded, personalizationActive, category]);

  const { state: streakState, loaded: streakLoaded } = useStreaks();

  // Launch state, resolved once when the on-device stores have
  // loaded: a user who already finished today's Feed before reopening
  // the app lands on All instead of the (empty) Feed view, and the
  // Feed pill moves to the end of the row until tomorrow. Mid-session
  // finishing changes nothing — this only applies at reopen.
  const [launchCaughtUp, setLaunchCaughtUp] = useState(false);
  const launchResolvedRef = useRef(false);
  useEffect(() => {
    if (launchResolvedRef.current) return;
    if (!personalizationLoaded || !streakLoaded) return;
    launchResolvedRef.current = true;
    if (personalizationActive && isDayComplete(streakState, todayStr())) {
      setLaunchCaughtUp(true);
      if (category === "feed") setCategory(null);
    }
  }, [
    personalizationLoaded,
    streakLoaded,
    personalizationActive,
    streakState,
    category,
  ]);

  const byPublished = useMemo(
    () =>
      [...rawStories].sort((a, b) => {
        const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
        const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
        return tb - ta;
      }),
    [rawStories],
  );

  const finishedTodayIds = useMemo(
    () => new Set(finishedOn(streakState, todayStr())),
    [streakState],
  );

  // Latch the streak day whenever the day's Feed is fully finished.
  // Finishing can happen from the story screen or the player without
  // returning here, so the check runs on any input change rather than
  // on a button; recordFeedCompletion is idempotent.
  useEffect(() => {
    if (!personalizationActive || !personalizationPrefs) return;
    recordFeedCompletion(
      personalizedFeed(byPublished, personalizationPrefs).map((s) => s.id),
    );
  }, [byPublished, personalizationActive, personalizationPrefs, streakState]);

  const stories = useMemo(() => {
    // The personalized Feed view shows the day's five best-matching
    // stories (see personalizedFeed in lib/personalization), minus the
    // ones already finished today — finished stories hide from Feed,
    // so the shrinking list is the day's progress. The All feed and
    // the category tabs keep pure published order, finished or not.
    if (category === "feed" && isPersonalizationActive(personalizationPrefs)) {
      return personalizedFeed(byPublished, personalizationPrefs).filter(
        (s) => !finishedTodayIds.has(s.id),
      );
    }
    return byPublished;
  }, [byPublished, category, personalizationPrefs, finishedTodayIds]);

  // Feed view, day's stories exist, and every one is finished.
  const feedCaughtUp =
    category === "feed" &&
    personalizationActive &&
    rawStories.length > 0 &&
    stories.length === 0;

  // Measured, since the header's height differs by platform (web has no inset).
  const [mobileHeadH, setMobileHeadH] = useState(0);
  const [topRowH, setTopRowH] = useState(0);
  const listRef = useRef<FlatList<Story>>(null);
  const todayLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const headerHeight = 96;

  const handleRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined
    );
    await refetch();
  }, [refetch]);

  const showLoading = isLoading && stories.length === 0;
  const showEmpty = !showLoading && stories.length === 0;

  const hPad = Math.max(16, insets.left + 4);

  const listPadding = useMemo(
    () => ({
      paddingTop: mobileHeadH > 0 ? mobileHeadH + 8 : insets.top + headerHeight,
      paddingBottom: bottomPad,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    }),
    [insets.top, insets.left, insets.right, bottomPad, mobileHeadH]
  );

  const listEmpty =
    showLoading ? (
      <View style={styles.loading}>
        <ActivityIndicator color={palette.accent} />
        <Text style={styles.loadingText}>
          Loading today's stories…
        </Text>
      </View>
    ) : feedCaughtUp ? (
      <EmptyState
          icon="checkmark-circle-outline"
          title="You're all caught up"
          message="You finished today's Feed — your streak is safe. New stories land tomorrow morning."
          actionLabel="Browse all stories"
          onAction={() => setCategory(null)}
        />
    ) : showEmpty ? (
      <EmptyState
          icon="newspaper-outline"
          title={
            error ? "Couldn't load the feed" : "Today's feed is being prepared"
          }
          message={
            error
              ? "Pull to refresh and try again."
              : "Today's stories haven't been loaded yet. Pull down to refresh."
          }
          actionLabel="Refresh now"
          onAction={handleRefresh}
        />
    ) : null;

  // Mobile: the logo row scrolls away with the feed while the category
  // tabs stay pinned to the top.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
    runOnJS(reportScroll)(e.contentOffset.y);
    runOnJS(onFeedScroll)(e.contentOffset.y);
  });
  const statusPad = (Platform.OS === "web" ? 16 : insets.top) + 8;
  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.min(Math.max(scrollY.value, 0), topRowH) }],
  }));
  const topRowStyle = useAnimatedStyle(() => ({
    opacity: topRowH > 0 ? 1 - Math.min(Math.max(scrollY.value, 0) / topRowH, 1) : 1,
  }));

  // Switching category keeps the tabs pinned rather than jumping back to the logo.
  const pickCategory = (next: FeedSelection) => {
    setCategory(next);
    if (scrollY.value > topRowH) listRef.current?.scrollToOffset({ offset: topRowH, animated: false });
  };

  // Desktop: tuck the header's title and pills away on a deliberate
  // downward scroll; bring them back on any upward scroll or near the top.
  const onDesktopScroll = (y: number) => {
    const ly = lastY.current;
    if (y < 20) setHeaderMini(false);
    else if (y > ly + 6 && y > 60) setHeaderMini(true);
    else if (y < ly - 6) setHeaderMini(false);
    if (Math.abs(y - ly) > 6 || y < 20) lastY.current = y;
  };

  if (isDesktop) {
    return (
      <View style={styles.container}>
        <DesktopHeader
          mini={headerMini}
          pinBelow
          onFullHeight={setDesktopHeadH}
          tools={
            <>
              {isFetching && stories.length > 0 ? (
                <ActivityIndicator size="small" color={palette.textDim} />
              ) : null}
              {AUTH_ENABLED && isGuest ? (
                <Pressable onPress={() => router.push("/login" as any)} style={styles.getAccountBtn}>
                  <Text style={styles.getAccountText}>Log in or sign up</Text>
                </Pressable>
              ) : null}
            </>
          }
          below={
            <View style={styles.desktopPills}>
              <CategoryFilter active={category} onChange={setCategory} inset={0} variant="glass" showForYou={showFeedTab} forYouLast={launchCaughtUp} />
            </View>
          }
        />
        <StoryGrid
          stories={stories}
          feature={!category || category === "feed"}
          fromContext={category ?? "all"}
          onScroll={(e) => onDesktopScroll(e.nativeEvent.contentOffset.y)}
          contentContainerStyle={{ paddingTop: desktopHeadH + 24, paddingHorizontal: 36, paddingBottom: 160 }}
          ListEmptyComponent={listEmpty}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View
        onLayout={(e) => setMobileHeadH(e.nativeEvent.layout.height)}
        style={[
          styles.header,
          {
            paddingTop: statusPad,
            paddingLeft: Math.max(0, insets.left),
            paddingRight: Math.max(0, insets.right),
          },
          headerStyle,
        ]}
      >
        <Animated.View
          onLayout={(e) => setTopRowH(e.nativeEvent.layout.height)}
          style={[styles.titleRow, { paddingHorizontal: hPad }, topRowStyle]}
        >
          <Image
            source={isDark ? LOGO_DARK : LOGO_LIGHT}
            style={{ width: 100, height: 30 }}
            resizeMode="contain"
            accessibilityLabel="CRRNT"
          />

          <View style={styles.headerActions}>
            {isFetching && stories.length > 0 ? (
              <ActivityIndicator
                size="small"
                color={palette.textDim}
                style={{ marginRight: 10 }}
              />
            ) : null}
            {AUTH_ENABLED && isGuest ? (
              <Pressable
                onPress={() => router.push("/login" as any)}
                style={styles.getAccountBtn}
              >
                <Text style={styles.getAccountText}>Log in or sign up</Text>
              </Pressable>
            ) : (
              <Text style={styles.dateLabel}>Today · {todayLabel}</Text>
            )}
          </View>
        </Animated.View>

        {/* Backdrop band so the pills never sit straight on a bright photo. */}
        <View style={styles.pillBand}>
          <BlurView
            intensity={40}
            tint={isDark ? "dark" : "light"}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.bg + "EB" }]} />
          <CategoryFilter active={category} onChange={pickCategory} inset={12} variant="glass" showForYou={showFeedTab} forYouLast={launchCaughtUp} />
        </View>
      </Animated.View>
      {/* Opaque strip over the status-bar area for the logo row to slide under. */}
      <View style={[styles.statusCover, { height: statusPad }]} />

      <Animated.FlatList
        ref={listRef}
        data={stories}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StoryCard story={item} fromContext={category ?? "all"} />}
        contentContainerStyle={listPadding}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        // Keep the render window ahead of a fast fling: more items per
        // batch, batches more often, and a wider window, so fast scrolls
        // meet rendered cards instead of blank space. (Cards vary in
        // height, so getItemLayout can't apply here.)
        windowSize={31}
        maxToRenderPerBatch={30}
        updateCellsBatchingPeriod={30}
        initialNumToRender={15}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && stories.length > 0}
            onRefresh={handleRefresh}
            tintColor={palette.accent}
            progressViewOffset={mobileHeadH}
          />
        }
        ListEmptyComponent={listEmpty ?? undefined}
      />
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: palette.bg },
    header: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
    },
    titleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingBottom: 10,
      backgroundColor: palette.bg,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
    },
    pillBand: {
      paddingBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.divider,
    },
    statusCover: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 11,
      backgroundColor: palette.bg,
    },
    dateLabel: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: palette.textMuted,
    },
    getAccountBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      backgroundColor: palette.accent,
      marginRight: 8,
    },
    getAccountText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: palette.onAccent,
    },
    desktopPills: {
      paddingTop: 14,
      paddingBottom: 14,
    },
    loading: {
      paddingVertical: 80,
      alignItems: "center",
      gap: 12,
    },
    loadingText: {
      fontFamily: "Inter_500Medium",
      color: palette.textMuted,
      fontSize: 13,
    },
  });
}
