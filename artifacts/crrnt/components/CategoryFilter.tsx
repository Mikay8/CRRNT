import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useThemeContext } from "@/contexts/ThemeContext";
import { CATEGORIES, CATEGORY_ICONS, type Category } from "@/constants/categories";

interface CategoryFilterProps {
  active: Category | null;
  onChange: (next: Category | null) => void;
  /** Horizontal inset of the scrolling row (desktop header aligns it flush). */
  inset?: number;
  /** "tabs" renders text tabs with an accent underline (mobile feed header). */
  variant?: "chips" | "tabs";
}

export function CategoryFilter({ active, onChange, inset = 16, variant = "chips" }: CategoryFilterProps) {
  const { theme: palette } = useThemeContext();

  const handle = (next: Category | null) => {
    Haptics.selectionAsync().catch(() => undefined);
    onChange(next);
  };

  if (variant === "tabs") {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.tabRow, { paddingHorizontal: inset }]}
      >
        {[{ key: null, label: "All", color: palette.text, icon: null }, ...CATEGORIES].map((cat) => {
          const on = active === cat.key;
          const color = on ? cat.color : palette.textMuted;
          return (
            <Pressable
              key={cat.key ?? "all"}
              onPress={() => handle(cat.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
            >
              {cat.icon ? <Ionicons name={CATEGORY_ICONS[cat.icon]} size={14} color={color} /> : null}
              <Text style={[styles.label, { color }]}>{cat.label}</Text>
              {on ? <View style={[styles.underline, { backgroundColor: palette.accent }]} /> : null}
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
  tabRow: {
    gap: 24,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 8,
    paddingBottom: 11,
  },
  underline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    borderRadius: 2,
  },
});

export default CategoryFilter;
