import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import type { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { NAV, useNavChrome, useTabBarBottom } from "@/contexts/NavChromeContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { DESKTOP, useIsDesktop } from "@/hooks/useLayoutMode";

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  index: { on: "trending-up", off: "trending-up" },
  saved: { on: "bookmark", off: "bookmark-outline" },
  settings: { on: "person-circle", off: "person-circle-outline" },
};

// The indicator's leading edge snaps fast and the trailing edge follows with
// overshoot, so it stretches toward the new tab before settling.
const OVERSHOOT = Easing.bezier(0.3, 1.15, 0.5, 1);
const FAST = { duration: 260, easing: OVERSHOOT };
const SLOW = { duration: 500, easing: OVERSHOOT };
const PAD = 5;

function TabButton({
  label,
  icon,
  focused,
  width,
  tint,
  hoverTint,
  onPress,
}: {
  label: string;
  icon: (typeof ICONS)[string];
  focused: boolean;
  width: number;
  tint: string;
  hoverTint: string;
  onPress: () => void;
}) {
  const { collapse } = useNavChrome();
  const pop = useSharedValue(1);
  const [hovered, setHovered] = useState(false);
  const color = hovered && !focused ? hoverTint : tint;
  const wasFocused = useRef(focused);

  useEffect(() => {
    if (focused && !wasFocused.current) {
      pop.value = withSequence(
        withTiming(0.82, { duration: 150 }),
        withTiming(1.06, { duration: 140 }),
        withTiming(1, { duration: 130 }),
      );
    }
    wasFocused.current = focused;
  }, [focused, pop]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: focused ? 1 : 1 - collapse.value,
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: collapse.value * 8 }, { scale: pop.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: 1 - collapse.value }));

  return (
    <Animated.View style={[{ width }, fadeStyle]}>
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        style={styles.tab}
      >
        <Animated.View style={iconStyle}>
          <Ionicons name={focused ? icon.on : icon.off} size={24} color={color} />
        </Animated.View>
        <Animated.Text style={[styles.label, { color }, labelStyle]}>{label}</Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

export default function GlassTabBar({ state, descriptors, emitter, navigateToTab }: TabBarProps) {
  // SDK 58 replaced the tab bar's `navigation` prop with `emitter` and
  // `navigateToTab`. useNavigation() here resolves to the parent navigator,
  // which has no emit(), so the props are the only way to fire tabPress.
  const { theme, isDark } = useThemeContext();
  const { collapse, expand, isCollapsed, setCollapsed } = useNavChrome();
  const { width: screenW } = useWindowDimensions();
  const tabBottom = useTabBarBottom();
  const isDesktop = useIsDesktop();

  // Desktop: a fixed-width pill parked bottom-left; mobile: full-width bar.
  const barW = isDesktop ? DESKTOP.navW : screenW - NAV.inset * 2;
  const left = isDesktop ? DESKTOP.margin : NAV.inset;
  const bottom = isDesktop ? DESKTOP.margin : tabBottom;
  const count = state.routes.length;
  const tabW = (barW - PAD * 2) / count;

  const index = useSharedValue(state.index);
  const indL = useSharedValue(PAD + state.index * tabW);
  const indR = useSharedValue(PAD + (state.index + 1) * tabW);
  const prevIndex = useRef(state.index);
  // Guard against rapid taps interleaving expand/navigate events and
  // hammering the navigator mid-transition (TestFlight blank-screen cause).
  // Only actual navigations stamp it; expand taps and focused taps don't,
  // so expand-then-tap-to-navigate still works.
  const lastNavAt = useRef(0);

  useEffect(() => {
    const movingRight = state.index > prevIndex.current;
    prevIndex.current = state.index;
    index.value = state.index;
    indL.value = withTiming(PAD + state.index * tabW, movingRight ? SLOW : FAST);
    indR.value = withTiming(PAD + (state.index + 1) * tabW, movingRight ? FAST : SLOW);
  }, [state.index, tabW, index, indL, indR]);

  const barStyle = useAnimatedStyle(() => ({
    width: interpolate(collapse.value, [0, 1], [barW, NAV.tabH]),
    opacity: 1 - expand.value * 0.8,
    transform: [{ translateY: expand.value * 140 }],
  }));

  // Collapsed, the row slides so the active tab sits centred in the button.
  const rowStyle = useAnimatedStyle(() => {
    const center = PAD + index.value * tabW + tabW / 2;
    return { transform: [{ translateX: collapse.value * (NAV.tabH / 2 - center) }] };
  });

  const indicatorStyle = useAnimatedStyle(() => {
    const c = collapse.value;
    const center = PAD + index.value * tabW + tabW / 2;
    const half = NAV.tabH / 2 - PAD;
    const left = interpolate(c, [0, 1], [indL.value, center - half]);
    const right = interpolate(c, [0, 1], [indR.value, center + half]);
    return { left, width: right - left };
  });

  const activeTint = theme.accent;
  const idleTint = theme.textMuted;

  return (
    <Animated.View
      style={[styles.bar, { left, bottom, borderColor: theme.borderStrong + "AA" }, barStyle]}
    >
      <BlurView
        intensity={Platform.OS === "android" ? 60 : 40}
        tint={isDark ? "dark" : "light"}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bgElevated + (isDark ? "B8" : "C8") }]} />
      <Animated.View style={[styles.row, { width: barW }, rowStyle]}>
        <Animated.View style={[styles.indicator, { backgroundColor: activeTint + "29" }, indicatorStyle]} />
        <View style={{ width: PAD }} />
        {state.routes.map((route, i) => {
          const focused = i === state.index;
          const { options } = descriptors[route.key];
          const label = typeof options.title === "string" ? options.title : route.name;
          const onPress = () => {
            if (isCollapsed) {
              setCollapsed(false);
              return;
            }
            if (!focused && Date.now() - lastNavAt.current < 300) {
              return;
            }
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              lastNavAt.current = Date.now();
              Haptics.selectionAsync().catch(() => undefined);
              navigateToTab(route.key);
            }
          };
          return (
            <TabButton
              key={route.key}
              label={label}
              icon={ICONS[route.name] ?? { on: "ellipse", off: "ellipse-outline" }}
              focused={focused}
              width={tabW}
              tint={focused ? activeTint : idleTint}
              hoverTint={theme.text}
              onPress={onPress}
            />
          );
        })}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    height: NAV.tabH,
    borderRadius: NAV.tabH / 2,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 18,
  },
  row: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
  },
  indicator: {
    position: "absolute",
    top: PAD,
    bottom: PAD,
    borderRadius: 999,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.1,
  },
});
