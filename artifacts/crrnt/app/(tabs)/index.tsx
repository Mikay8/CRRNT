import { useCallback, useMemo, useRef, useState } from "react";
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
import { router } from "expo-router";
import {
  useListStories,
  type Story,
} from "@workspace/api-client-react";
import StoryCard from "@/components/StoryCard";
import CategoryFilter from "@/components/CategoryFilter";
import EmptyState from "@/components/EmptyState";
import type { Category } from "@/constants/categories";
import { AUTH_ENABLED } from "@/constants/features";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import type { ThemeColors } from "@/constants/theme";
import { useChromeBottomPadding, useNavChrome } from "@/contexts/NavChromeContext";
import DesktopHeader from "@/components/DesktopHeader";
import StoryGrid from "@/components/StoryGrid";
import { useIsDesktop } from "@/hooks/useLayoutMode";
import { reportScroll } from "@/hooks/useFastScroll";

const LOGO_DARK = require("@/assets/images/full-logo-dark.png") as number;
const LOGO_LIGHT = require("@/assets/images/full-logo-light.png") as number;

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { isDark, theme: palette } = useThemeContext();
  const { user, accessToken } = useAuth();
  const isGuest = !user;
  const [category, setCategory] = useState<Category | null>(null);

  const styles = useMemo(() => createStyles(palette), [palette]);
  const { onFeedScroll } = useNavChrome();
  const bottomPad = useChromeBottomPadding();
  const isDesktop = useIsDesktop();
  const [headerMini, setHeaderMini] = useState(false);
  const [desktopHeadH, setDesktopHeadH] = useState(200);
  const lastY = useRef(0);

  const { data, isLoading, isFetching, refetch, error } = useListStories(
    category ? { category } : undefined,
    { query: { staleTime: 60_000 } as any }
  );

  const rawStories: Story[] = data?.stories ?? [];

  const stories = useMemo(() => {
    return [...rawStories].sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });
  }, [rawStories]);

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
  const pickCategory = (next: Category | null) => {
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
          below={<CategoryFilter active={category} onChange={setCategory} inset={0} variant="tabs" />}
        />
        <StoryGrid
          stories={stories}
          feature={!category}
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

        <CategoryFilter active={category} onChange={pickCategory} inset={hPad} variant="tabs" />
      </Animated.View>
      {/* Opaque strip over the status-bar area for the logo row to slide under. */}
      <View style={[styles.statusCover, { height: statusPad }]} />

      <Animated.FlatList
        ref={listRef}
        data={stories}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StoryCard story={item} />}
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
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.divider,
      backgroundColor: palette.bg,
    },
    titleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingBottom: 8,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
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
      color: "#fff",
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
