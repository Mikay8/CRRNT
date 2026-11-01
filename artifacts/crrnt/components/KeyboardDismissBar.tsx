import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ThemeColors } from "@/constants/theme";

/**
 * iOS keyboard close button pinned directly above the keyboard via
 * InputAccessoryView — the pattern from Apple's own search UI: a
 * round ✕ that travels with the keyboard, so it can never scroll
 * out of reach the way an in-card Done button can. Pair it with
 * `inputAccessoryViewID={nativeID}` on the TextInput.
 *
 * Renders nothing off iOS: Android keeps whatever in-field dismiss
 * the screen already has (and most Android keyboards ship their own
 * hide key).
 */
export function KeyboardDismissBar({
  nativeID,
  theme,
}: {
  nativeID: string;
  theme: ThemeColors;
}) {
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={nativeID} backgroundColor="transparent">
      {/* No bar behind the button (Mikayla, 2026-11-01): the strip is
          fully transparent and the round ✕ floats on its own, like
          the close button in Apple's search UI. */}
      <View style={styles.bar}>
        <Pressable
          onPress={() => Keyboard.dismiss()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close keyboard"
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: theme.surfaceHigh,
              borderColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="close" size={18} color={theme.text} />
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "transparent",
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default KeyboardDismissBar;
