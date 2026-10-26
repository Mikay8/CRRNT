import { useEffect, useState } from "react";
import { Image, type ImageStyle } from "expo-image";
import type { StyleProp } from "react-native";
import type { Category } from "@/constants/categories";

// Raster renders of the category art (source SVGs live alongside). expo-image
// draws SVGs at their intrinsic "fit inside" size and ignores contentFit, which
// left the art only part-filling taller frames like the story hero.
const PLACEHOLDERS: Record<Category, number> = {
  business: require("@/assets/images/crrnt-business-16x9.jpg"),
  celebrity: require("@/assets/images/crrnt-celebrity-16x9.jpg"),
  entertainment: require("@/assets/images/crrnt-entertainment-16x9.jpg"),
  government: require("@/assets/images/crrnt-government-16x9.jpg"),
  health: require("@/assets/images/crrnt-health-16x9.jpg"),
  science: require("@/assets/images/crrnt-science-16x9.jpg"),
  sports: require("@/assets/images/crrnt-sports-16x9.jpg"),
  tech: require("@/assets/images/crrnt-tech-16x9.jpg"),
  world: require("@/assets/images/crrnt-world-16x9.jpg"),
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

  const fallback = categoryPlaceholder(category);
  return (
    <Image
      source={uri && !failed ? { uri } : fallback}
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
