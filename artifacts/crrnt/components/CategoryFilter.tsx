import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { useThemeContext } from "@/contexts/ThemeContext";
import { CATEGORIES, CATEGORY_ICONS, type FeedSelection } from "@/constants/categories";

interface CategoryFilterProps {
  active: FeedSelection;
  onChange: (next: FeedSelection) => void;
  /** Horizontal inset of the scrolling row (desktop header aligns it flush). */
  inset?: number;
  /** "glass" renders each category as its own frosted pill (feed header). */
  variant?: "chips" | "glass";
  /** Show the personalized "Feed" pill ahead of All (native feed). */
  showForYou?: boolean;
  /** Move the Feed pill to the end of the row — the user already
   * finished today's Feed, so it yields home position to All. */
  forYouLast?: boolean;
}

export function CategoryFilter({ active, onChange, inset = 16, variant = "chips", showForYou = false, forYouLast = false }: CategoryFilterProps) {
  const { theme: palette, isDark } = useThemeContext();

  const handle = (next: FeedSelection) => {
    Haptics.selectionAsync().catch(() => undefined);
    onChange(next);
  };

  if (variant === "glass") {
    const feedItem = {
      key: "feed" as FeedSelection,
      label: "Feed",
      color: palette.accent,
      iconName: "sparkles" as const,
    };
    const items: {
      key: FeedSelection;
      label: string;
      color: string;
      iconName: keyof typeof Ionicons.glyphMap | null;
    }[] = [
      ...(showForYou && !forYouLast ? [feedItem] : []),
      { key: null, label: "All", color: palette.text, iconName: null },
      ...CATEGORIES.map((c) => ({
        key: c.key as FeedSelection,
        label: c.label,
        color: c.color,
        iconName: CATEGORY_ICONS[c.icon] as keyof typeof Ionicons.glyphMap,
      })),
      ...(showForYou && forYouLast ? [feedItem] : []),
    ];
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.glassRow, { paddingHorizontal: inset }]}
      >
        {items.map((cat) => {
          const on = active === cat.key;
          // Labels stay in text colours for AA contrast (several category
          // colours fall under 4.5:1 in light mode); the icon carries the colour.
          const labelColor = on ? palette.text : palette.textMuted;
          const iconColor = on ? cat.color : palette.textMuted;
          return (
            <Pressable
              key={cat.key ?? "all"}
              onPress={() => handle(cat.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                styles.glassTab,
                cat.iconName ? null : styles.glassTabNoIcon,
                { borderColor: on ? palette.text + "33" : palette.borderStrong + "AA", opacity: pressed ? 0.7 : 1 },
              ]}
            >
              {/* No BlurView on web: Safari mangles backdrop-filter inside
                  an overflow:hidden rounded pill, rendering the labels as
                  smeared blobs. The near-opaque fill below already gives
                  the pill its look, so skipping the blur on web changes
                  nothing visible. Native keeps the blur. */}
              {Platform.OS !== "web" ? (
                <BlurView
                  intensity={Platform.OS === "android" ? 60 : 40}
                  tint={isDark ? "dark" : "light"}
                  experimentalBlurMethod="dimezisBlurView"
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {/* Near-opaque fill so labels keep their contrast over any photo. */}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.bgElevated + "F0" }]} />
              {on ? <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.text + "1F" }]} /> : null}
              {cat.iconName ? <Ionicons name={cat.iconName} size={14} color={iconColor} /> : null}
              <Text style={[styles.label, { color: labelColor }]}>{cat.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, { paddingHorizontal: inset }]}
    >
      {showForYou && !forYouLast ? (
        <Chip
          label="Feed"
          color={palette.accent}
          icon="sparkles"
          active={active === "feed"}
          onPress={() => handle("feed")}
          palette={palette}
        />
      ) : null}
      <Chip
        label="All"
        color={palette.text}
        active={active === null}
        onPress={() => handle(null)}
        palette={palette}
      />
      {CATEGORIES.map((cat) => (
        <Chip
          key={cat.key}
          label={cat.label}
          icon={CATEGORY_ICONS[cat.icon]}
          color={cat.color}
          active={active === cat.key}
          onPress={() => handle(cat.key)}
          palette={palette}
        />
      ))}
      {showForYou && forYouLast ? (
        <Chip
          label="Feed"
          color={palette.accent}
          icon="sparkles"
          active={active === "feed"}
          onPress={() => handle("feed")}
          palette={palette}
        />
      ) : null}
    </ScrollView>
  );
}

interface ChipProps {
  label: string;
  color: string;
  active: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  palette: ReturnType<typeof useThemeContext>["theme"];
}

function Chip({ label, color, active, icon, onPress, palette }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? color + "26" : palette.surface,
          borderColor: active ? color : palette.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? color : palette.textMuted} /> : null}
      <Text
        style={[
          styles.label,
          { color: active ? color : palette.textMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    letterSpacing: 0.2,
  },
  glassRow: {
    gap: 8,
    paddingVertical: 4,
  },
  glassTab: {
    height: 38,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  glassTabNoIcon: {
    paddingHorizontal: 16,
  },
});

export default CategoryFilter;
