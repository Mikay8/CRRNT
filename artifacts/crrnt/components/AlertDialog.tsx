import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeContext } from "@/contexts/ThemeContext";

export interface AlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

interface AlertDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

export function AlertDialog({ visible, title, message, buttons }: AlertDialogProps) {
  const { theme } = useThemeContext();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.body}>
            <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
            {message ? (
              <Text style={[styles.message, { color: theme.textMuted }]}>{message}</Text>
            ) : null}
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View style={styles.buttons}>
            {buttons.map((btn, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => [
                  styles.button,
                  i < buttons.length - 1 && [styles.buttonBorder, { borderRightColor: theme.border }],
                  pressed && { backgroundColor: theme.surfaceHigh },
                ]}
                onPress={btn.onPress}
              >
                <Text
                  style={[
                    styles.buttonText,
                    btn.style === "cancel"
                      ? { color: theme.textMuted, fontFamily: "Inter_400Regular" }
                      : btn.style === "destructive"
                      ? { color: theme.negative }
                      : { color: theme.accent },
                  ]}
                >
                  {btn.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    gap: 8,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    textAlign: "center",
  },
  message: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  divider: {
    height: 1,
  },
  buttons: {
    flexDirection: "row",
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonBorder: {
    borderRightWidth: 1,
  },
  buttonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
});
