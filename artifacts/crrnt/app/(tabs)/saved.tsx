import { useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EmptyState from "@/components/EmptyState";
import StoryCard from "@/components/StoryCard";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";
import { useChromeBottomPadding } from "@/contexts/NavChromeContext";
import DesktopHeader from "@/components/DesktopHeader";
import StoryGrid from "@/components/StoryGrid";
import { useIsDesktop } from "@/hooks/useLayoutMode";
import { reportScroll } from "@/hooks/useFastScroll";

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const { saved } = useSavedStories();
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const bottomPad = useChromeBottomPadding();

  const hPad = Math.max(16, insets.left + 4);
  const isDesktop = useIsDesktop();
  const [headerMini, setHeaderMini] = useState(false);
  const [headH, setHeadH] = useState(160);
  const lastY = useRef(0);

  const empty = (
    <EmptyState
      icon="bookmark-outline"
      title="Nothing saved yet"
      message={
        isDesktop
          ? "Swipe left on a story, or hit its bookmark, to keep it here for later."
          : "Tap the bookmark on any story to keep it here for later."
      }
    />
  );

  if (isDesktop) {
    const countLabel = `${saved.length} ${saved.length === 1 ? "story" : "stories"}`;
    return (
      <View style={styles.container}>
        <DesktopHeader
          title="Saved"
          mini={headerMini}
          onFullHeight={setHeadH}
          aside={<Text style={styles.subtitle}>{countLabel} · swipe left on a card to save</Text>}
        />
        <StoryGrid
          stories={saved}
          feature={false}
          fromContext="saved"
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            const ly = lastY.current;
            if (y < 20) setHeaderMini(false);
            else if (y > ly + 6 && y > 60) setHeaderMini(true);
            else if (y < ly - 6) setHeaderMini(false);
            if (Math.abs(y - ly) > 6 || y < 20) lastY.current = y;
          }}
          contentContainerStyle={{ paddingTop: headH + 24, paddingHorizontal: 36, paddingBottom: 160 }}
          ListEmptyComponent={empty}
        />
      </View>
    );
  }

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
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StoryCard story={item} fromContext="saved" />}
        contentContainerStyle={{
          paddingTop: insets.top + 96,
          paddingBottom: bottomPad,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
        showsVerticalScrollIndicator={false}
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
