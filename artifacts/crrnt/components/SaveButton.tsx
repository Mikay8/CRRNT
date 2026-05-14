import { Alert, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSavedStories } from "@/contexts/SavedStoriesContext";
import type { Story } from "@workspace/api-client-react";

interface SaveButtonProps {
  story: Story;
  size?: number;
}

export function SaveButton({ story, size = 22 }: SaveButtonProps) {
  const { isSaved, toggleSaved } = useSavedStories();
  const { user } = useAuth();
  const { theme: palette } = useThemeContext();
  const saved = isSaved(story.id);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (!user) {
      Alert.alert(
        "Create a free account",
        "Sign up to save stories and pick up where you left off.",
        [
          { text: "Sign in", onPress: () => router.push("/login" as any) },
          { text: "Create account", onPress: () => router.push("/register" as any) },
          { text: "Not now", style: "cancel" },
        ]
      );
      return;
    }
    toggleSaved(story).catch(() => undefined);
  };

  return (
    <Pressable
      onPress={handlePress}
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
