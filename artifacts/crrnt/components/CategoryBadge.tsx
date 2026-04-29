import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getCategoryMeta } from "@/constants/categories";

interface CategoryBadgeProps {
  category: string | null | undefined;
  size?: "sm" | "md";
}

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  mic: "mic",
  "hardware-chip": "hardware-chip",
  business: "business",
  trophy: "trophy",
};

export function CategoryBadge({ category, size = "sm" }: CategoryBadgeProps) {
  const meta = getCategoryMeta(category);
  if (!meta) return null;

  const dims = size === "md"
    ? { padV: 6, padH: 12, font: 13, icon: 14 }
    : { padV: 4, padH: 9, font: 11, icon: 11 };

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: meta.color + "22",
          paddingVertical: dims.padV,
          paddingHorizontal: dims.padH,
        },
      ]}
    >
      <Ionicons name={ICON_MAP[meta.icon]} size={dims.icon} color={meta.color} />
      <Text style={[styles.text, { color: meta.color, fontSize: dims.font }]}>
        {meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  text: {
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
});

export default CategoryBadge;
