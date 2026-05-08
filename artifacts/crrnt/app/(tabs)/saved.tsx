import { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EmptyState from "@/components/EmptyState";
import StoryCard from "@/components/StoryCard";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const { saved } = useSavedStories();
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const hPad = Math.max(16, insets.left + 4);

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
        <Text style={[styles.brand, { paddingHorizontal: hPad }]}>Saved</Text>
        <Text style={[styles.subtitle, { paddingHorizontal: hPad }]}>
          {saved.length} {saved.length === 1 ? "story" : "stories"} you bookmarked
        </Text>
      </View>

      <FlatList
        data={saved}
        keyExtractor={(item) => item.articleId}
        renderItem={({ item }) => <StoryCard story={item} />}
        contentContainerStyle={{
          paddingTop: insets.top + 96,
          paddingBottom: insets.bottom + 100,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="bookmark-outline"
            title="Nothing saved yet"
            message="Tap the bookmark on any story to keep it here for later."
          />
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
      paddingHorizontal: 16,
      paddingBottom: 14,
      backgroundColor: palette.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.divider,
    },
    brand: {
      fontFamily: "Inter_700Bold",
      fontSize: 28,
      color: palette.text,
      letterSpacing: -0.5,
    },
    subtitle: {
      marginTop: 2,
      fontFamily: "Inter_500Medium",
      fontSize: 13,
      color: palette.textMuted,
      paddingBottom: 2,
    },
  });
}
