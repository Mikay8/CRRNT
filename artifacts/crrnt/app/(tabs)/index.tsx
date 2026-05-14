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
import { useThemeContext } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import type { ThemeColors } from "@/constants/theme";

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

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(
      () => setDebouncedQuery(text.trim()),
      300
    );
  };

  const isSearchActive = searchVisible && debouncedQuery.length >= 1;

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
      paddingTop: insets.top + headerHeight,
      paddingBottom: insets.bottom + (isGuest ? 24 : 100),
      paddingLeft: insets.left,
      paddingRight: insets.right,
    }),
    [insets.top, insets.bottom, insets.left, insets.right, isGuest]
  );

  return (
    <View style={styles.container}>
      <View
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
            {isGuest && !searchVisible && (
              <Pressable
                onPress={() => router.push("/login" as any)}
                style={styles.getAccountBtn}
              >
                <Text style={styles.getAccountText}>Get account</Text>
              </Pressable>
            )}
            {!searchVisible && isFetching && stories.length > 0 ? (
              <ActivityIndicator
                size="small"
                color={palette.textDim}
                style={{ marginRight: 8 }}
              />
            ) : null}
            {!searchVisible && (
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
        refreshControl={
          !isSearchActive ? (
            <RefreshControl
              refreshing={isFetching && stories.length > 0}
              onRefresh={handleRefresh}
              tintColor={palette.accent}
            />
          ) : undefined
        }
        ListEmptyComponent={
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
          ) : null
        }
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
