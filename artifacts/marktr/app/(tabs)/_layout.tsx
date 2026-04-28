import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import palette from "@/constants/colors";

export default function TabsLayout() {
  const liquidGlass = isLiquidGlassAvailable();
  const tabBarBg =
    liquidGlass || Platform.OS === "ios"
      ? "transparent"
      : palette.bgElevated;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textDim,
        tabBarLabelStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.2,
        },
        tabBarStyle:
          Platform.OS === "web"
            ? {
                backgroundColor: palette.bgElevated,
                borderTopColor: palette.border,
                height: 84,
                paddingBottom: 34,
              }
            : {
                position: "absolute",
                backgroundColor: tabBarBg,
                borderTopColor: palette.border,
              },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            liquidGlass ? null : (
              <BlurView
                tint="dark"
                intensity={80}
                style={StyleSheet.absoluteFill}
              />
            )
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.bgElevated }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Feed",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-up" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: "Saved",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bookmark" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
