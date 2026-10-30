import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { router, type Tabs, useRootNavigationState, useSegments } from "expo-router";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { NAV, useNavChrome, useTabBarBottom } from "@/contexts/NavChromeContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { DESKTOP, useIsDesktop } from "@/hooks/useLayoutMode";

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  index: { on: "trending-up", off: "trending-up" },
  search: { on: "search", off: "search-outline" },
  saved: { on: "bookmark", off: "bookmark-outline" },
  settings: { on: "person-circle", off: "person-circle-outline" },
};

// The indicator's leading edge snaps fast and the trailing edge follows with
// overshoot, so it stretches toward the new tab before settling.
const OVERSHOOT = Easing.bezier(0.3, 1.15, 0.5, 1);
const FAST = { duration: 260, easing: OVERSHOOT };
const SLOW = { duration: 500, easing: OVERSHOOT };
const PAD = 5;
// Sliding a finger along the bar: the pill lifts and swells a little, then
// springs into the tab it's released over.
const SETTLE = { stiffness: 380, damping: 26, mass: 1 };
const SWELL = 0.14;

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
  // The desktop story panel sits where the nav would; the nav steps aside.
  const segments = useSegments();
  const hiddenForStory = isDesktop && segments[0] === "story";

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
  // Scrub state: `lift` 0 → 1 while a finger slides along the bar, `stretch`
  // grows with its speed, and `scrubTab` is the tab under it (null at rest).
  const lift = useSharedValue(0);
  const stretch = useSharedValue(0);
  const hoverTab = useSharedValue(state.index);
  const [scrubTab, setScrubTab] = useState<number | null>(null);
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

  const activeTint = theme.accent;
  const idleTint = theme.textMuted;

  // The active-tab pill fades out as the bar collapses, so the collapsed
  // feed button is just the glass circle and the icon — no blue disc
  // behind it making the icon look off-centre.
  const indicatorStyle = useAnimatedStyle(() => {
    const c = collapse.value;
    const center = PAD + index.value * tabW + tabW / 2;
    const half = NAV.tabH / 2 - PAD;
    const left = interpolate(c, [0, 1], [indL.value, center - half]);
    const right = interpolate(c, [0, 1], [indR.value, center + half]);
    const l = lift.value;
    const st = stretch.value;
    return {
      left,
      width: right - left,
      opacity: interpolate(c, [0, 1], [1, 0]),
      transform: [{ scaleY: 1 + l * 0.1 - st * 0.12 }],
      backgroundColor: l > 0 ? activeTint + (l > 0.5 ? "40" : "33") : activeTint + "29",
    };
  });

  const goTo = (i: number) => {
    const route = state.routes[i];
    const focused = i === state.index;
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

  const onScrubTab = (i: number | null) => {
    if (i !== null) Haptics.selectionAsync().catch(() => undefined);
    setScrubTab(i);
  };

  // Horizontal drags only, so plain taps still reach the tab buttons.
  const scrub = Gesture.Pan()
    .enabled(!isCollapsed)
    .activeOffsetX([-8, 8])
    .failOffsetY([-20, 20])
    .onStart((e) => {
      lift.value = withSpring(1, SETTLE);
      hoverTab.value = Math.min(count - 1, Math.max(0, Math.floor((e.x - PAD) / tabW)));
      runOnJS(onScrubTab)(hoverTab.value);
    })
    .onUpdate((e) => {
      const center = Math.min(PAD + (count - 0.5) * tabW, Math.max(PAD + tabW / 2, e.x));
      stretch.value = Math.min(Math.abs(e.velocityX) / 4000, 0.3);
      const half = (tabW / 2) * (1 + SWELL + stretch.value);
      indL.value = center - half;
      indR.value = center + half;
      const tab = Math.min(count - 1, Math.max(0, Math.floor((center - PAD) / tabW)));
      if (tab !== hoverTab.value) {
        hoverTab.value = tab;
        runOnJS(onScrubTab)(tab);
      }
    })
    // onEnd, not onFinalize: a plain tap never activates the pan and must not land here.
    .onEnd(() => {
      const tab = hoverTab.value;
      lift.value = withSpring(0, SETTLE);
      stretch.value = withSpring(0, SETTLE);
      indL.value = withSpring(PAD + tab * tabW, SETTLE);
      indR.value = withSpring(PAD + (tab + 1) * tabW, SETTLE);
      runOnJS(onScrubTab)(null);
      runOnJS(goTo)(tab);
    });

  if (hiddenForStory) return null;

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
      <GestureDetector gesture={scrub}>
      <Animated.View style={[styles.row, { width: barW }, rowStyle]}>
        <Animated.View style={[styles.indicator, indicatorStyle]} />
        <View style={{ width: PAD }} />
        {state.routes.map((route, i) => {
          // While scrubbing, the tab under the finger lights up instead.
          const focused = i === (scrubTab ?? state.index);
          const { options } = descriptors[route.key];
          const label = typeof options.title === "string" ? options.title : route.name;
          const onPress = () => {
            if (isCollapsed) {
              setCollapsed(false);
              return;
            }
            goTo(i);
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
      </GestureDetector>
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
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    letterSpacing: 0.1,
  },
});

// Mirrors the order and titles in app/(tabs)/_layout.tsx.
const TABS = [
  { name: "index", title: "Feed", href: "/" },
  { name: "search", title: "Search", href: "/search" },
  { name: "saved", title: "Saved", href: "/saved" },
  { name: "settings", title: "Settings", href: "/settings" },
] as const;

/**
 * The tab bar for screens pushed above the tabs (the story screen), which
 * have no tab navigator of their own. It shows the tab underneath as active,
 * and any tap pops back down to the tabs on the tapped one.
 */
export function DetachedTabBar() {
  const tabsIndex = tabsIndexIn(useRootNavigationState()) ?? 0;
  const props = {
    state: { index: tabsIndex, routes: TABS.map((t) => ({ key: t.name, name: t.name })) },
    descriptors: Object.fromEntries(TABS.map((t) => [t.name, { options: { title: t.title } }])),
    emitter: {
      emit: ({ target }: { target: string }) => {
        const tab = TABS.find((t) => t.name === target);
        if (tab) router.dismissTo(tab.href);
        return { defaultPrevented: true };
      },
    },
    navigateToTab: () => undefined,
  };
  return <GlassTabBar {...(props as unknown as TabBarProps)} />;
}

/** The focused tab's index, wherever the tabs navigator sits in the tree. */
function tabsIndexIn(state: any): number | undefined {
  for (const route of state?.routes ?? []) {
    if (route.name === "(tabs)") return route.state?.index;
    const nested = tabsIndexIn(route.state);
    if (nested !== undefined) return nested;
  }
  return undefined;
}
