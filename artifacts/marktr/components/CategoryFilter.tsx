import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import palette from "@/constants/colors";
import { CATEGORIES, type Category } from "@/constants/categories";

interface CategoryFilterProps {
  active: Category | null;
  onChange: (next: Category | null) => void;
}

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  mic: "mic",
  "hardware-chip": "hardware-chip",
  business: "business",
  trophy: "trophy",
  briefcase: "briefcase-outline",
  planet: "planet-outline",
};

export function CategoryFilter({ active, onChange }: CategoryFilterProps) {
  const handle = (next: Category | null) => {
    Haptics.selectionAsync().catch(() => undefined);
    onChange(next);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      <Chip
        label="All"
        color={palette.text}
        active={active === null}
        onPress={() => handle(null)}
      />
      {CATEGORIES.map((cat) => (
        <Chip
          key={cat.key}
          label={cat.label}
          icon={ICON_MAP[cat.icon]}
          color={cat.color}
          active={active === cat.key}
          onPress={() => handle(cat.key)}
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
}

function Chip({ label, color, active, icon, onPress }: ChipProps) {
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
    paddingHorizontal: 16,
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
});

export default CategoryFilter;
