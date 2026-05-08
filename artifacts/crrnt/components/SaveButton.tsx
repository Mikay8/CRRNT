import { Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import type { Story } from "@workspace/api-client-react";

interface SaveButtonProps {
  story: Story;
  size?: number;
}

export function SaveButton({ story, size = 22 }: SaveButtonProps) {
  const { isSaved, toggleSaved } = useSavedStories();
  const { theme: palette } = useThemeContext();
  const saved = isSaved(story.articleId);

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        toggleSaved(story).catch(() => undefined);
      }}
      hitSlop={10}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons
        name={saved ? "bookmark" : "bookmark-outline"}
        size={size}
        color={saved ? palette.accent : palette.textMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    padding: 4,
  },
});

export default SaveButton;
