import { Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { FadeInDown, FadeOut, useAnimatedStyle } from "react-native-reanimated";
import { NAV, useNavChrome, useTabBarBottom } from "@/contexts/NavChromeContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useToast } from "@/contexts/ToastContext";
import { miniFrame, usePlayerDock } from "@/hooks/usePlayerDock";
import { DESKTOP, desktopBarFrame, useIsDesktop } from "@/hooks/useLayoutMode";
import { useWindowDimensions } from "react-native";

export default function ToastHost() {
  const { toast, hideToast } = useToast();
  const { theme, isDark } = useThemeContext();
  const { collapse, expand, queue } = useNavChrome();
  const isDesktop = useIsDesktop();
  const { width: W } = useWindowDimensions();
  const { inTabs, visible: playerVisible } = usePlayerDock();
  const tabBottom = useTabBarBottom();

  const posStyle = useAnimatedStyle(() => {
    if (isDesktop) {
      // Centred over the player bar (or over the nav when nothing is playing).
      const bar = desktopBarFrame(W, queue.value * (DESKTOP.queueW + 28));
      const centre = playerVisible ? bar.left + bar.width / 2 : DESKTOP.margin + DESKTOP.navW / 2;
      const base = playerVisible ? bar.bottom : DESKTOP.margin;
      return {
        left: centre - W / 2,
        width: W,
        bottom: base + DESKTOP.barH + 14,
        opacity: 1 - expand.value,
      };
    }
    const m = miniFrame(collapse.value, inTabs, tabBottom);
    const top = playerVisible ? m.bottom + m.height : inTabs ? tabBottom + NAV.tabH : tabBottom;
    return { left: 0, width: W, bottom: top + 12, opacity: 1 - expand.value };
  });

  if (!toast) return null;

  return (
    <Animated.View style={[styles.wrap, posStyle]} pointerEvents="box-none">
      <Animated.View
        key={toast.key}
        entering={FadeInDown.springify().damping(26).stiffness(260)}
        exiting={FadeOut.duration(160)}
        style={[styles.toast, { borderColor: theme.borderStrong + "AA" }]}
      >
        <BlurView
          intensity={40}
          tint={isDark ? "dark" : "light"}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bgElevated + "C8" }]} />
        <View style={[styles.dot, { backgroundColor: toast.color }]} />
        <Text style={[styles.text, { color: theme.text }]}>{toast.text}</Text>
        {toast.action ? (
          <Pressable
            hitSlop={10}
            onPress={() => {
              toast.action?.onPress();
              hideToast();
            }}
          >
            <Text style={[styles.action, { color: toast.color }]}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    alignItems: "center",
    zIndex: 35,
  },
  toast: {
    height: 38,
    paddingLeft: 12,
    paddingRight: 16,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  text: { fontFamily: "Inter_600SemiBold", fontSize: 13.5 },
  action: { fontFamily: "Inter_700Bold", fontSize: 13.5, marginLeft: 4 },
});
