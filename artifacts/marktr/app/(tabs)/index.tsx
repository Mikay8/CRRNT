import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  useListStories,
  useTriggerIngestion,
  type Story,
} from "@workspace/api-client-react";
import palette from "@/constants/colors";
import StoryCard from "@/components/StoryCard";
import CategoryFilter from "@/components/CategoryFilter";
import EmptyState from "@/components/EmptyState";
import type { Category } from "@/constants/categories";

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<Category | null>(null);

  const { data, isLoading, isFetching, refetch, error } = useListStories(
    category ? { category } : undefined,
    { query: { staleTime: 60_000 } }
  );

  const triggerIngestion = useTriggerIngestion();

  const stories: Story[] = data?.stories ?? [];
  const headerHeight = 96;

  const handleRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (!stories.length) {
      try {
        await triggerIngestion.mutateAsync();
      } catch {
        // background ingestion may take a while; ignore client-side error
      }
    }
    await refetch();
  }, [refetch, stories.length, triggerIngestion]);

  const showEmpty = !isLoading && stories.length === 0;
  const showLoading = isLoading && stories.length === 0;

  const hPad = Math.max(16, insets.left + 4);

  const listPadding = useMemo(
    () => ({
      paddingTop: insets.top + headerHeight,
      paddingBottom: insets.bottom + 100,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    }),
    [insets.top, insets.bottom, insets.left, insets.right]
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
            backgroundColor: palette.bg,
          },
        ]}
      >
        <View style={[styles.titleRow, { paddingHorizontal: hPad }]}>
          <Text style={styles.brand}>Marktr</Text>
          {isFetching && stories.length > 0 ? (
            <ActivityIndicator size="small" color={palette.textDim} />
          ) : null}
        </View>
        <CategoryFilter active={category} onChange={setCategory} />
      </View>

      <FlatList
        data={stories}
        keyExtractor={(item) => item.articleId}
        renderItem={({ item }) => <StoryCard story={item} />}
        contentContainerStyle={listPadding}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && stories.length > 0}
            onRefresh={handleRefresh}
            tintColor={palette.accent}
          />
        }
        ListEmptyComponent={
          showLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.loadingText}>Loading today's stories…</Text>
            </View>
          ) : showEmpty ? (
            <EmptyState
              icon="newspaper-outline"
              title={
                error
                  ? "Couldn't load the feed"
                  : "Today's feed is being prepared"
              }
              message={
                error
                  ? "Pull to refresh and try again."
                  : "Marktr enriches each story with a financial angle. Tap below to fetch the latest batch."
              }
              actionLabel={
                triggerIngestion.isPending ? "Refreshing…" : "Refresh now"
              }
              onAction={handleRefresh}
            />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 8,
  },
  brand: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: palette.text,
    letterSpacing: -0.5,
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
