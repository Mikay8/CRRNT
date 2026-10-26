import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemeContext } from "@/contexts/ThemeContext";

export default function TabsLayout() {
  const { theme } = useThemeContext();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textDim,
        tabBarLabelStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.2,
        },
        tabBarStyle: {
          backgroundColor: theme.bgElevated,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          ...(Platform.OS === "web" && {
            height: 84,
            paddingBottom: 34,
          }),
        },
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
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}