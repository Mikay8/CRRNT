import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useListStories,
  useSearchStories,
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
  const { isDark, theme: palette, toggleTheme } = useThemeContext();
  const { user, accessToken } = useAuth();
  const isGuest = !user;
  const [category, setCategory] = useState<Category | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const styles = useMemo(() => createStyles(palette), [palette]);
  const { onFeedScroll } = useNavChrome();
  const bottomPad = useChromeBottomPadding();
  const isDesktop = useIsDesktop();
  const [headerMini, setHeaderMini] = useState(false);
  const [desktopHeadH, setDesktopHeadH] = useState(200);
  const lastY = useRef(0);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(
      () => setDebouncedQuery(text.trim()),
      300
    );
  };

  // Desktop keeps the search box open, so any query is a live search.
  const isSearchActive = (searchVisible || isDesktop) && debouncedQuery.length >= 1;

  const { data, isLoading, isFetching, refetch, error } = useListStories(
    category ? { category } : undefined,
    { query: { staleTime: 60_000, enabled: !isSearchActive } as any }
  );

  const { data: searchData, isFetching: searchFetching } = useSearchStories(
    { q: debouncedQuery || " " },
    { query: { staleTime: 30_000, enabled: isSearchActive } as any }
  );

  const rawStories: Story[] = isSearchActive
    ? (searchData?.stories ?? [])
    : (data?.stories ?? []);

  const stories = useMemo(() => {
    if (isSearchActive) return rawStories;
    return [...rawStories].sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });
  }, [rawStories, isSearchActive]);

  // Measured, since the header's height differs by platform (web has no inset).
  const [mobileHeadH, setMobileHeadH] = useState(0);
  const headerHeight = 96;

  const openSearch = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined
    );
    setSearchVisible(true);
    setSearchQuery("");
    setDebouncedQuery("");
  };

  const closeSearch = () => {
    setSearchVisible(false);
    setSearchQuery("");
    setDebouncedQuery("");
  };

  const handleRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined
    );
    await refetch();
  }, [refetch]);

  const showLoading =
    isLoading && !isSearchActive
      ? stories.length === 0
      : isSearchActive && searchFetching && stories.length === 0;
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
          {isSearchActive ? "Searching…" : "Loading today's stories…"}
        </Text>
      </View>
    ) : showEmpty ? (
      isSearchActive ? (
        <EmptyState
          icon="search-outline"
          title="No results"
          message={`No stories matched "${debouncedQuery}". Try a ticker symbol, company name, or topic.`}
        />
      ) : (
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
      )
    ) : null;

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
          onFullHeight={setDesktopHeadH}
          aside={
            isSearchActive ? (
              <Text style={styles.searchMetaText}>
                {searchFetching
                  ? "Searching…"
                  : `${searchData?.totalCount ?? 0} ${searchData?.totalCount === 1 ? "result" : "results"} for "${debouncedQuery}"`}
              </Text>
            ) : null
          }
          tools={
            <>
              {isFetching && stories.length > 0 ? (
                <ActivityIndicator size="small" color={palette.textDim} />
              ) : null}
              <View style={styles.desktopSearch}>
                <Ionicons name="search-outline" size={18} color={palette.textDim} />
                <TextInput
                  style={styles.desktopSearchInput}
                  placeholder="Search stories, tickers, topics"
                  placeholderTextColor={palette.textDim}
                  value={searchQuery}
                  onChangeText={handleSearchChange}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {searchQuery ? (
                  <Pressable onPress={closeSearch} hitSlop={8} accessibilityLabel="Clear search">
                    <Ionicons name="close" size={16} color={palette.textDim} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                onPress={toggleTheme}
                style={({ hovered }) => [styles.roundBtn, hovered && { borderColor: palette.borderStrong }]}
                accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={19} color={palette.textMuted} />
              </Pressable>
              {AUTH_ENABLED && isGuest ? (
                <Pressable onPress={() => router.push("/login" as any)} style={styles.getAccountBtn}>
                  <Text style={styles.getAccountText}>Log in or sign up</Text>
                </Pressable>
              ) : null}
            </>
          }
          below={
            <View style={styles.desktopPills}>
              <CategoryFilter active={category} onChange={setCategory} inset={0} />
            </View>
          }
        />
        <StoryGrid
          stories={stories}
          feature={!category && !isSearchActive}
          onScroll={(e) => onDesktopScroll(e.nativeEvent.contentOffset.y)}
          contentContainerStyle={{ paddingTop: desktopHeadH + 24, paddingHorizontal: 36, paddingBottom: 160 }}
          ListEmptyComponent={listEmpty}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        onLayout={(e) => setMobileHeadH(e.nativeEvent.layout.height)}
        style={[
          styles.header,
          {
            paddingTop: (Platform.OS === "web" ? 16 : insets.top) + 8,
            paddingLeft: Math.max(0, insets.left),
            paddingRight: Math.max(0, insets.right),
          },
        ]}
      >
        <View style={[styles.titleRow, { paddingHorizontal: hPad }]}>
          {searchVisible ? (
            <TextInput
              style={styles.searchInput}
              placeholder="Ticker, company, topic…"
              placeholderTextColor={palette.textDim}
              value={searchQuery}
              onChangeText={handleSearchChange}
              autoFocus
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : (
            <Image
              source={isDark ? LOGO_DARK : LOGO_LIGHT}
              style={{ width: 100, height: 30 }}
              resizeMode="contain"
              accessibilityLabel="CRRNT"
            />
          )}

          <View style={styles.headerActions}>
            {AUTH_ENABLED && isGuest && !searchVisible && (
              <Pressable
                onPress={() => router.push("/login" as any)}
                style={styles.getAccountBtn}
              >
                <Text style={styles.getAccountText}>Log in or sign up</Text>
              </Pressable>
            )}
            {!searchVisible && isFetching && stories.length > 0 ? (
              <ActivityIndicator
                size="small"
                color={palette.textDim}
                style={{ marginRight: 8 }}
              />
            ) : null}
            {!searchVisible && Platform.OS === "web" && (
              <Pressable
                onPress={toggleTheme}
                hitSlop={10}
                style={styles.iconBtn}
                accessibilityLabel={
                  isDark ? "Switch to light mode" : "Switch to dark mode"
                }
              >
                <Ionicons
                  name={isDark ? "sunny-outline" : "moon-outline"}
                  size={22}
                  color={palette.textMuted}
                />
              </Pressable>
            )}
            <Pressable
              onPress={searchVisible ? closeSearch : openSearch}
              hitSlop={10}
              style={styles.iconBtn}
            >
              <Ionicons
                name={searchVisible ? "close" : "search-outline"}
                size={22}
                color={palette.textMuted}
              />
            </Pressable>
          </View>
        </View>

        {searchVisible ? (
          <View style={[styles.searchMeta, { paddingHorizontal: hPad }]}>
            {isSearchActive && !searchFetching ? (
              <Text style={styles.searchMetaText}>
                {searchData?.totalCount ?? 0}{" "}
                {searchData?.totalCount === 1 ? "result" : "results"} for{" "}
                <Text style={styles.searchMetaQuery}>"{debouncedQuery}"</Text>
              </Text>
            ) : isSearchActive && searchFetching ? (
              <Text style={styles.searchMetaText}>Searching…</Text>
            ) : (
              <Text style={styles.searchMetaText}>
                Search titles, tickers, insights &amp; more
              </Text>
            )}
          </View>
        ) : (
          <CategoryFilter active={category} onChange={setCategory} />
        )}
      </View>

      <FlatList
        data={stories}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StoryCard story={item} />}
        contentContainerStyle={listPadding}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          reportScroll(e.nativeEvent.contentOffset.y);
          onFeedScroll(e.nativeEvent.contentOffset.y);
        }}
        scrollEventThrottle={16}
        refreshControl={
          !isSearchActive ? (
            <RefreshControl
              refreshing={isFetching && stories.length > 0}
              onRefresh={handleRefresh}
              tintColor={palette.accent}
            />
          ) : undefined
        }
        ListEmptyComponent={listEmpty}
      />

      {/* Blur the feed behind the search bar until there's a query; tap to dismiss */}
      {searchVisible && !isSearchActive ? (
        <Pressable
          style={styles.searchBackdrop}
          onPress={closeSearch}
          accessibilityLabel="Close search"
        >
          <BlurView
            intensity={40}
            tint={isDark ? "dark" : "light"}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        </Pressable>
      ) : null}
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
      paddingBottom: 12,
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
    iconBtn: {
      padding: 4,
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
    searchInput: {
      flex: 1,
      height: 36,
      backgroundColor: palette.surfaceHigh,
      borderRadius: 10,
      paddingHorizontal: 12,
      color: palette.text,
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      marginRight: 10,
    },
    desktopSearch: {
      height: 40,
      width: 300,
      borderRadius: 20,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
    },
    desktopSearchInput: {
      flex: 1,
      minWidth: 0,
      height: "100%",
      color: palette.text,
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      outlineStyle: "none",
    } as object,
    roundBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
    },
    desktopPills: {
      paddingTop: 18,
      paddingBottom: 16,
    },
    searchBackdrop: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 5,
    },
    searchMeta: {
      height: 36,
      justifyContent: "center",
    },
    searchMetaText: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: palette.textDim,
    },
    searchMetaQuery: {
      color: palette.textMuted,
      fontFamily: "Inter_500Medium",
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
