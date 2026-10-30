import { useEffect, useState } from "react";
import { Image, type ImageStyle } from "expo-image";
import type { StyleProp } from "react-native";
import type { Category } from "@/constants/categories";
import { useIsFastScrolling } from "@/hooks/useFastScroll";

// Raster renders of the category art (source SVGs live alongside). expo-image
// draws SVGs at their intrinsic "fit inside" size and ignores contentFit, which
// left the art only part-filling taller frames like the story hero.
const PLACEHOLDERS: Record<Category, number> = {
  business: require("@/assets/images/crrnt-lines-business.jpg"),
  celebrity: require("@/assets/images/crrnt-lines-celebrity.jpg"),
  entertainment: require("@/assets/images/crrnt-lines-entertainment.jpg"),
  government: require("@/assets/images/crrnt-lines-government.jpg"),
  health: require("@/assets/images/crrnt-lines-health.jpg"),
  science: require("@/assets/images/crrnt-lines-science.jpg"),
  sports: require("@/assets/images/crrnt-lines-sports.jpg"),
  tech: require("@/assets/images/crrnt-lines-tech.jpg"),
  world: require("@/assets/images/crrnt-lines-world.jpg"),
};

export function categoryPlaceholder(category: string | null | undefined): number {
  return PLACEHOLDERS[category as Category] ?? PLACEHOLDERS.world;
}

/**
 * A story's lead image, falling back to the category's placeholder art when
 * the story has no media_url, the remote image fails to load (feeds
 * sometimes link images that 404 or block hotlinking), or it turns out to be
 * a 1x1 analytics pixel that "loads" but renders as nothing.
 */
export default function StoryImage({
  uri,
  category,
  style,
}: {
  uri: string | null | undefined;
  category: string | null | undefined;
  style?: StyleProp<ImageStyle>;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);

  // Cards that mount mid-fling keep the category art until scrolling
  // settles; once a card has started its real image it keeps it.
  const fastScrolling = useIsFastScrolling();
  const [started, setStarted] = useState(!fastScrolling);
  useEffect(() => {
    if (!fastScrolling) setStarted(true);
  }, [fastScrolling]);

  const fallback = categoryPlaceholder(category);
  return (
    <Image
      source={uri && !failed && started ? { uri } : fallback}
      placeholder={fallback}
      placeholderContentFit="cover"
      contentFit="cover"
      transition={150}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        if (uri && !failed && e.source.width <= 2 && e.source.height <= 2) setFailed(true);
      }}
      style={style}
    />
  );
}
