import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Image } from "expo-image";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setBaseUrl } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import MiniAudioBar from "@/components/MiniAudioBar";
import { ThemeProvider, useThemeContext } from "@/contexts/ThemeContext";
import { AudioProvider } from "@/contexts/AudioContext";
import { SavedStoriesProvider } from "@/contexts/SavedStoriesContext";

SplashScreen.preventAutoHideAsync();

const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
if (apiDomain) {
  setBaseUrl(`https://${apiDomain}`);
} else if (process.env.EXPO_PUBLIC_API_BASE) {
  setBaseUrl(process.env.EXPO_PUBLIC_API_BASE);
} else if (Platform.OS === "web" && typeof window !== "undefined") {
  setBaseUrl(window.location.origin);
}

// Show alerts for incoming notifications while app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerPushToken(): Promise<void> {
  try {
    if (Platform.OS === "web") return;
    if (!Device.isDevice) return; // simulators can't receive push

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") return;

    // Android needs a notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "CRRNT",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#06B6D4",
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    const base = apiDomain ? `https://${apiDomain}` : "";
    await fetch(`${base}/api/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    // Push registration is non-critical — fail silently
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ThemedApp() {
  const { isDark, theme } = useThemeContext();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <SavedStoriesProvider>
                <AudioProvider>
                  <StatusBar style={isDark ? "light" : "dark"} />
                  <Stack
                    screenOptions={{
                      headerStyle: { backgroundColor: theme.bg },
                      headerTintColor: theme.text,
                      headerTitleStyle: {
                        fontFamily: "Inter_700Bold",
                        color: theme.text,
                      },
                      contentStyle: { backgroundColor: theme.bg },
                    }}
                  >
                    <Stack.Screen
                      name="(tabs)"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="story/[id]"
                      options={{
                        title: "",
                        headerBackTitle: "Back",
                        headerTransparent: true,
                        presentation: "card",
                      }}
                    />
                    <Stack.Screen name="+not-found" options={{ title: "Not found" }} />
                  </Stack>
                  <MiniAudioBar />
                </AudioProvider>
              </SavedStoriesProvider>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    registerPushToken();
  }, []);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={launchStyles.container}>
        <StatusBar style="light" />
        <Image
          source={require("../assets/gif/crrnt-splash-dark.gif")}
          style={launchStyles.logo}
          contentFit="contain"
        />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}

const launchStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#090D12",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
});
