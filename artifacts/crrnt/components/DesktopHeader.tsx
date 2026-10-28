import { useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";

const LOGO_DARK = require("@/assets/images/full-logo-dark.png") as number;
const LOGO_LIGHT = require("@/assets/images/full-logo-light.png") as number;

const EASE = { duration: 350, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };

/**
 * Sticky, blurred desktop page header: logo + date and tools on top, then the
 * optional page title and an optional row (category pills). Scrolling down tucks the
 * title and pills away, leaving just the top row — or, with `pinBelow`, tucks the
 * top row away and keeps the row below pinned.
 */
export default function DesktopHeader({
  title,
  aside,
  tools,
  below,
  mini,
  pinBelow = false,
  onFullHeight,
}: {
  title?: string;
  aside?: React.ReactNode;
  tools?: React.ReactNode;
  below?: React.ReactNode;
  mini: boolean;
  /** Tuck the logo row on scroll instead of the title and `below` row. */
  pinBelow?: boolean;
  /** Reports the header's untucked height so the page can pad its content. */
  onFullHeight: (h: number) => void;
}) {
  const { theme, isDark } = useThemeContext();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const m = useSharedValue(mini ? 1 : 0);
  const [titleH, setTitleH] = useState(44);
  const [belowH, setBelowH] = useState(below ? 68 : 18);
  const [topH, setTopH] = useState(40);
  const fullH = useRef(0);

  useEffect(() => {
    m.value = withTiming(mini ? 1 : 0, EASE);
  }, [mini, m]);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const titleStyle = useAnimatedStyle(() => ({
    height: titleH * (1 - m.value),
    marginTop: 14 * (1 - m.value),
    opacity: 1 - Math.min(1, m.value * 1.6),
  }));
  const belowStyle = useAnimatedStyle(() =>
    pinBelow
      ? {}
      : {
          height: belowH * (1 - m.value) + 14 * m.value,
          opacity: 1 - Math.min(1, m.value * 1.6),
        },
  );
  const topStyle = useAnimatedStyle(() =>
    pinBelow
      ? {
          height: topH * (1 - m.value),
          opacity: 1 - Math.min(1, m.value * 1.6),
        }
      : {},
  );

  return (
    <View
      style={styles.head}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (!mini && h > fullH.current) {
          fullH.current = h;
          onFullHeight(h);
        }
      }}
    >
      <BlurView intensity={30} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg + (mini ? "E6" : "D1") }]} />

      <Animated.View style={[styles.clip, topStyle]}>
        <View
          style={[styles.top, pinBelow && { paddingBottom: 12 }]}
          onLayout={(e) => setTopH(e.nativeEvent.layout.height)}
        >
          <View style={styles.brand}>
            <Image
              source={isDark ? LOGO_DARK : LOGO_LIGHT}
              style={{ width: 96, height: 28 }}
              resizeMode="contain"
              accessibilityLabel="CRRNT"
            />
            <Text style={styles.date}>{today.toUpperCase()}</Text>
          </View>
          {tools ? <View style={styles.tools}>{tools}</View> : null}
        </View>
      </Animated.View>

      {title || aside ? (
        <Animated.View style={[styles.clip, titleStyle]}>
          <View style={styles.titleRow} onLayout={(e) => setTitleH(e.nativeEvent.layout.height)}>
            {title ? <Text style={styles.h1}>{title}</Text> : null}
            {aside ? <View style={styles.aside}>{aside}</View> : null}
          </View>
        </Animated.View>
      ) : null}

      <Animated.View style={[styles.clip, belowStyle]}>
        <View onLayout={(e) => setBelowH(e.nativeEvent.layout.height)}>
          {below ?? <View style={{ height: 18 }} />}
        </View>
      </Animated.View>
    </View>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    head: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 15,
      paddingTop: 24,
      paddingHorizontal: 36,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
      overflow: "hidden",
    },
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
    brand: { flexDirection: "row", alignItems: "center", gap: 14 },
    date: {
      fontFamily: "Inter_500Medium",
      fontSize: 11,
      letterSpacing: 1.5,
      color: theme.textMuted,
      paddingLeft: 15,
      borderLeftWidth: 1,
      borderLeftColor: theme.border,
    },
    tools: { flexDirection: "row", alignItems: "center", gap: 10 },
    clip: { overflow: "hidden" },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 20,
    },
    h1: { fontFamily: "Inter_700Bold", fontSize: 32, letterSpacing: -0.5, color: theme.text },
    aside: { marginBottom: 6 },
  });
}
