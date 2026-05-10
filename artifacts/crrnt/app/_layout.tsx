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
import { Redirect, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  setBaseUrl,
  setAuthTokenGetter,
} from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import MiniAudioBar from "@/components/MiniAudioBar";
import { ThemeProvider, useThemeContext } from "@/contexts/ThemeContext";
import { AudioProvider } from "@/contexts/AudioContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SavedStoriesProvider } from "@/contexts/SavedStoriesContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";

SplashScreen.preventAutoHideAsync();

const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
if (apiDomain) {
  setBaseUrl(`https://${apiDomain}`);
} else if (process.env.EXPO_PUBLIC_API_BASE) {
  setBaseUrl(process.env.EXPO_PUBLIC_API_BASE);
} else if (Platform.OS === "web" && typeof window !== "undefined") {
  setBaseUrl(window.location.origin);
}

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
    if (!Device.isDevice) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "CRRNT",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#06B6D4",
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const base = apiDomain ? `https://${apiDomain}` : "";
    await fetch(`${base}/api/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenData.data }),
    });
  } catch {
    // Push registration is non-critical
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

/**
 * Wires the JWT token from AuthContext into the shared API client fetcher
 * so that all generated React Query hooks automatically include auth headers.
 */
function AuthTokenWirer() {
  const { accessToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(accessToken ? () => accessToken : null);
  }, [accessToken]);
  return null;
}

/**
 * Auth gate: redirects to login when unauthenticated,
 * to onboarding when onboarding is incomplete.
 */
function AuthGate() {
  const { user, hydrated } = useAuth();
  const segments = useSegments();

  if (!hydrated) return null;

  const seg0 = segments[0] as string | undefined;
  const inAuthGroup = seg0 === "auth";
  const inOnboarding = seg0 === "onboarding";

  if (!user && !inAuthGroup) {
    return <Redirect href={"/auth/login" as any} />;
  }

  if (user && inAuthGroup) {
    return <Redirect href={!user.onboarding_complete ? ("/onboarding" as any) : "/(tabs)"} />;
  }

  if (user && !user.onboarding_complete && !inOnboarding) {
    return <Redirect href={"/onboarding" as any} />;
  }

  return null;
}

function ThemedApp() {
  const { isDark, theme } = useThemeContext();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ErrorBoundary>
            <AuthProvider>
              <QueryClientProvider client={queryClient}>
                <AuthTokenWirer />
                <AuthGate />
                <SubscriptionProvider>
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
                        <Stack.Screen
                          name="auth/login"
                          options={{ headerShown: false }}
                        />
                        <Stack.Screen
                          name="auth/register"
                          options={{ headerShown: false }}
                        />
                        <Stack.Screen
                          name="auth/forgot-password"
                          options={{ headerShown: false }}
                        />
                        <Stack.Screen
                          name="onboarding"
                          options={{ headerShown: false, gestureEnabled: false }}
                        />
                        <Stack.Screen
                          name="settings/preferences"
                          options={{ headerShown: false, presentation: "card" }}
                        />
                        <Stack.Screen
                          name="+not-found"
                          options={{ title: "Not found" }}
                        />
                      </Stack>
                      <MiniAudioBar />
                    </AudioProvider>
                  </SavedStoriesProvider>
                </SubscriptionProvider>
              </QueryClientProvider>
            </AuthProvider>
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
  logo: { width: "100%", height: "100%" },
});
