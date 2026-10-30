import { useMemo, useState } from "react";
import {
  FlatList,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import StoryCard from "@/components/StoryCard";
import type { Story } from "@workspace/api-client-react";
import { reportScroll } from "@/hooks/useFastScroll";

const MIN_COL = 300;
const GAP = 20;

interface Cell {
  story: Story;
  span: number;
}

/**
 * Desktop card grid: as many ≥300px columns as fit. With `feature`, the
 * first story takes a double-width cell (once there's room for two columns).
 * Rows are virtualised through a FlatList.
 */
export default function StoryGrid({
  stories,
  feature,
  contentContainerStyle,
  onScroll,
  ListEmptyComponent,
  ListHeaderComponent,
  fromContext,
}: {
  stories: Story[];
  feature: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  ListEmptyComponent?: React.ReactElement | null;
  ListHeaderComponent?: React.ReactElement | null;
  /** List context forwarded to each card's story navigation (see StoryCard). */
  fromContext?: string;
}) {
  const [width, setWidth] = useState(0);
  const cols = Math.max(1, Math.floor((width + GAP) / (MIN_COL + GAP)));
  const colW = (width - GAP * (cols - 1)) / cols;

  const rows = useMemo(() => {
    const out: Cell[][] = [];
    let row: Cell[] = [];
    let used = 0;
    stories.forEach((story, i) => {
      const span = feature && i === 0 && cols >= 2 ? 2 : 1;
      if (used + span > cols) {
        out.push(row);
        row = [];
        used = 0;
      }
      row.push({ story, span });
      used += span;
    });
    if (row.length) out.push(row);
    return out;
  }, [stories, feature, cols]);

  return (
    <FlatList
      data={width > 0 ? rows : []}
      keyExtractor={(row) => row[0].story.id}
      onScroll={(e) => {
        reportScroll(e.nativeEvent.contentOffset.y);
        onScroll?.(e);
      }}
      scrollEventThrottle={16}
      // Same fling headroom as the phone feed list (see index.tsx).
      windowSize={31}
      maxToRenderPerBatch={30}
      updateCellsBatchingPeriod={30}
      initialNumToRender={15}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator
      ListHeaderComponent={
        <>
          {ListHeaderComponent}
          {/* Measures the content width the columns are laid out in. */}
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} />
        </>
      }
      ListEmptyComponent={width > 0 ? (ListEmptyComponent ?? undefined) : undefined}
      renderItem={({ item: row }) => (
        <View style={{ flexDirection: "row", gap: GAP, marginBottom: GAP, alignItems: "flex-start" }}>
          {row.map(({ story, span }) => (
            <View key={story.id} style={{ width: colW * span + GAP * (span - 1) }}>
              <StoryCard story={story} variant={span > 1 ? "feature" : "grid"} fromContext={fromContext} />
            </View>
          ))}
        </View>
      )}
    />
  );
}
