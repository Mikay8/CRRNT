import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useNavChrome } from "@/contexts/NavChromeContext";
import { DESKTOP, useIsDesktop } from "@/hooks/useLayoutMode";

/**
 * Mobile: pushes the app back slightly as the full-screen player rises over it.
 * Desktop: makes room on the right for the queue panel instead.
 */
export default function RecedingScreens({ children }: { children: React.ReactNode }) {
  const { expand, queue } = useNavChrome();
  const isDesktop = useIsDesktop();
  const style = useAnimatedStyle(() => {
    if (isDesktop) {
      return {
        marginRight: queue.value * (DESKTOP.queueW + 28),
        borderRadius: 0,
        transform: [{ translateY: 0 }, { scale: 1 }],
      };
    }
    const p = Math.max(0, Math.min(1, expand.value));
    return {
      marginRight: 0,
      borderRadius: p * 40,
      transform: [{ translateY: p * 12 }, { scale: 1 - p * 0.07 }],
    };
  });
  return <Animated.View style={[styles.fill, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: "hidden" },
});
