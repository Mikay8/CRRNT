import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSearchStories, type Story } from "@workspace/api-client-react";
import StoryCard from "@/components/StoryCard";
import EmptyState from "@/components/EmptyState";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";
import { useChromeBottomPadding } from "@/contexts/NavChromeContext";
import { reportScroll } from "@/hooks/useFastScroll";
import DesktopHeader from "@/components/DesktopHeader";
import StoryGrid from "@/components/StoryGrid";
import { useIsDesktop } from "@/hooks/useLayoutMode";

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const bottomPad = useChromeBottomPadding();
  const hPad = Math.max(16, insets.left + 4);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [headH, setHeadH] = useState(0);
  const isDesktop = useIsDesktop();
  const [desktopHeadH, setDesktopHeadH] = useState(200);

  const handleChange = (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQuery(text.trim()), 300);
  };

  const clear = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setQuery("");
    setDebouncedQuery("");
  };

  const isActive = debouncedQuery.length >= 1;
  const { data, isFetching } = useSearchStories(
    { q: debouncedQuery || " " },
    { query: { staleTime: 30_000, enabled: isActive } as any }
  );
  const stories: Story[] = isActive ? (data?.stories ?? []) : [];

  const empty = !isActive ? (
    <EmptyState
      icon="search-outline"
      title="Search today's stories"
      message="Find stories by title, ticker, company or topic."
    />
  ) : isFetching ? (
    <View style={styles.loading}>
      <ActivityIndicator color={palette.accent} />
    </View>
  ) : (
    <EmptyState
      icon="search-outline"
      title="No results"
      message={`No stories matched "${debouncedQuery}". Try a ticker symbol, company name, or topic.`}
    />
  );

  const input = (
    <View style={[styles.inputWrap, isDesktop ? styles.inputDesktop : { marginHorizontal: hPad }]}>
      <Ionicons name="search-outline" size={20} color={palette.textMuted} />
      <TextInput
        style={styles.input}
        placeholder="Ticker, company, topic…"
        placeholderTextColor={palette.textDim}
        value={query}
        onChangeText={handleChange}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={isDesktop}
      />
      {query ? (
        <Pressable onPress={clear} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close" size={18} color={palette.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );

  const resultCount =
    isActive && !isFetching
      ? `${data?.totalCount ?? 0} ${data?.totalCount === 1 ? "result" : "results"} for "${debouncedQuery}"`
      : null;

  if (isDesktop) {
    return (
      <View style={styles.container}>
        <DesktopHeader
          title="Search"
          mini={false}
          onFullHeight={setDesktopHeadH}
          aside={resultCount ? <Text style={styles.metaDesktop}>{resultCount}</Text> : null}
          below={<View style={styles.desktopBelow}>{input}</View>}
        />
        <StoryGrid
          stories={stories}
          feature={false}
          contentContainerStyle={{ paddingTop: desktopHeadH + 24, paddingHorizontal: 36, paddingBottom: 160 }}
          ListEmptyComponent={empty}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}
        style={[
          styles.header,
          {
            paddingTop: (Platform.OS === "web" ? 16 : insets.top) + 8,
            paddingLeft: Math.max(0, insets.left),
            paddingRight: Math.max(0, insets.right),
          },
        ]}
      >
        <Text style={[styles.title, { paddingHorizontal: hPad }]}>Search</Text>
        {input}
        {resultCount ? (
          <Text style={[styles.meta, { paddingHorizontal: hPad }]}>{resultCount}</Text>
        ) : null}
      </View>

      <FlatList
        data={stories}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StoryCard story={item} />}
        contentContainerStyle={{
          paddingTop: headH > 0 ? headH + 8 : insets.top + 140,
          paddingBottom: bottomPad,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={empty}
        onScroll={(e) => reportScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
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
      backgroundColor: palette.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.divider,
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 28,
      color: palette.text,
      letterSpacing: -0.5,
      paddingBottom: 12,
    },
    inputWrap: {
      height: 48,
      borderRadius: 14,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
    },
    input: {
      flex: 1,
      minWidth: 0,
      height: "100%",
      color: palette.text,
      fontFamily: "Inter_400Regular",
      fontSize: 16,
      outlineStyle: "none",
    } as object,
    meta: {
      marginTop: 10,
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: palette.textDim,
    },
    inputDesktop: {
      maxWidth: 560,
    },
    desktopBelow: {
      paddingTop: 18,
      paddingBottom: 16,
    },
    metaDesktop: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: palette.textMuted,
    },
    loading: {
      paddingVertical: 80,
      alignItems: "center",
    },
  });
}
