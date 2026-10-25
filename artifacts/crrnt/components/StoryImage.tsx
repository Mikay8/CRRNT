import { useEffect, useState } from "react";
import { Image, type ImageStyle } from "expo-image";
import type { StyleProp } from "react-native";
import type { Category } from "@/constants/categories";

// expo-image (unlike react-native's Image) renders SVG, so the per-category
// art can be required directly as a local asset.
const PLACEHOLDERS: Record<Category, number> = {
  business: require("@/assets/images/crrnt-business-16x9.svg"),
  celebrity: require("@/assets/images/crrnt-celebrity-16x9.svg"),
  entertainment: require("@/assets/images/crrnt-entertainment-16x9.svg"),
  government: require("@/assets/images/crrnt-government-16x9.svg"),
  health: require("@/assets/images/crrnt-health-16x9.svg"),
  science: require("@/assets/images/crrnt-science-16x9.svg"),
  sports: require("@/assets/images/crrnt-sports-16x9.svg"),
  tech: require("@/assets/images/crrnt-tech-16x9.svg"),
  world: require("@/assets/images/crrnt-world-16x9.svg"),
};

export function categoryPlaceholder(category: string | null | undefined): number {
  return PLACEHOLDERS[category as Category] ?? PLACEHOLDERS.world;
}

/**
 * A story's lead image, falling back to the category's placeholder art when
 * the story has no media_url or the remote image fails to load (feeds
 * sometimes link images that 404 or block hotlinking).
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
      style={style}
    />
  );
}
