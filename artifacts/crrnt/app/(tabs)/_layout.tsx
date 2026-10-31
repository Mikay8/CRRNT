import { Platform } from "react-native";
import { Tabs } from "expo-router";
import GlassTabBar from "@/components/GlassTabBar";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false, animation: "none" }}
    >
      <Tabs.Screen name="index" options={{ title: "Feed" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
      <Tabs.Screen name="saved" options={{ title: "Saved" }} />
      <Tabs.Screen
        name="settings"
        options={{ title: Platform.OS === "web" ? "Settings" : "You" }}
      />
    </Tabs>
  );
}
