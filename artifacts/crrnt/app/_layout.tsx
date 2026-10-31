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
  Outfit_800ExtraBold,
} from "@expo-google-fonts/outfit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Image } from "expo-image";
import { Stack, router, useSegments } from "expo-router";
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
import { AUTH_ENABLED } from "@/constants/features";
import { reportDeviceMetrics } from "@/lib/deviceMetrics";
import NowPlaying from "@/components/player/NowPlaying";
import RecedingScreens from "@/components/player/RecedingScreens";
import { useIsDesktop } from "@/hooks/useLayoutMode";
import ToastHost from "@/components/ToastHost";
import { ThemeProvider, useThemeContext } from "@/contexts/ThemeContext";
import { AudioProvider } from "@/contexts/AudioContext";
import { NavChromeProvider } from "@/contexts/NavChromeContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
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
    // Respect an explicit in-app opt-out: without this check, startup
    // would re-register on every launch and silently undo the toggle.
    const { isNotificationsOptedOut } = await import("../lib/notifications");
    if (await isNotificationsOptedOut()) return;

    // Welcome screen owns the first notification ask: if it hasn't been
    // seen yet and the OS permission is still undecided, don't prompt
    // here — the welcome screen asks first (soft ask, then system
    // prompt). Users who already granted or denied never see welcome
    // and flow through here unchanged.
    const { hasSeenWelcome } = await import("../lib/welcome");
    if (!(await hasSeenWelcome())) {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === "undetermined") return;
    }

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

    // Standalone (TestFlight/App Store) builds need the EAS project ID that
    // `eas init` writes to app.json; Expo Go can infer it.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
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

function AuthGate() {
  const { user, isGuest, hydrated, enterGuestMode } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (!hydrated) return;

    const seg0 = segments[0] as string | undefined;
    const inAuthGroup = seg0 === "auth";
    const inOnboarding = seg0 === "onboarding";
    const isPublicScreen = seg0 === "login" || seg0 === "register" || inAuthGroup;

    // Auth hidden: bounce any direct visit to login/register/forgot-password back to the feed
    if (!AUTH_ENABLED && isPublicScreen) {
      if (!user && !isGuest) enterGuestMode();
      router.replace("/(tabs)" as any);
      return;
    }

    if (!user && !isGuest && !isPublicScreen) {
      enterGuestMode();
      return;
    }

    if (user && isPublicScreen) {
      router.replace((!user.onboarding_complete ? "/onboarding" : "/(tabs)") as any);
      return;
    }

    if (user && !user.onboarding_complete && !inOnboarding) {
      router.replace("/onboarding" as any);
    }
  }, [user, isGuest, hydrated, segments]);

  return null;
}

/**
 * Routes first-run users to the welcome screen. Native only, and only
 * while the OS notification permission is still undecided: users who
 * already granted or denied have decided, so welcome is marked seen for
 * them and never shown. Runs on segment changes; the welcome screen
 * itself guards against deep links after dismissal.
 */
function WelcomeGate() {
  const segments = useSegments();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === "web") return;
        if (!Device.isDevice) return;
        if (segments[0] === "welcome") return;
        const { hasSeenWelcome, markWelcomeSeen } = await import("../lib/welcome");
        if (await hasSeenWelcome()) return;
        const { status } = await Notifications.getPermissionsAsync();
        if (cancelled) return;
        if (status === "undetermined") {
          router.replace("/welcome" as any);
        } else {
          // Already decided — no welcome needed, and don't re-check.
          await markWelcomeSeen();
        }
      } catch {
        // Welcome is non-critical; the feed stays reachable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [segments]);
  return null;
}

/**
 * Routes first-run users to the personalization quiz. Native only, and
 * only when no prefs are stored on this device (lib/personalization.ts).
 * Runs after the welcome screen: while the notification permission is
 * still undecided the welcome gate goes first, and this gate defers —
 * when welcome is dismissed the segment change re-runs it. Skipping the
 * quiz stores a skipped record, so it also never reappears; Settings →
 * Your feed reopens it in edit mode.
 */
function PersonalizationGate() {
  const segments = useSegments();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === "web") return;
        if (segments[0] === "personalize" || segments[0] === "welcome") return;
        const { hasSeenWelcome } = await import("../lib/welcome");
        if (!(await hasSeenWelcome())) {
          const { status } = await Notifications.getPermissionsAsync();
          if (status === "undetermined") return; // welcome goes first
        }
        const { loadPersonalization } = await import("../lib/personalization");
        const prefs = await loadPersonalization();
        if (cancelled) return;
        if (prefs === null) {
          router.replace("/personalize" as any);
        }
      } catch {
        // Personalization is non-critical; the feed stays reachable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [segments]);
  return null;
}

/**
 * Routes notification taps. Both CRRNT push types land on the feed for now:
 * the Morning Edition IS the feed, and breaking cards render at the top of
 * it. (Breaking items link external articles today, not CRRNT stories, so
 * there is no story route to deep-link to yet.)
 */
function NotificationTapRouter() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string } | undefined;
      if (data?.type === "digest" || data?.type === "breaking") {
        router.push("/(tabs)" as any);
      }
    });
    return () => sub.remove();
  }, []);
  return null;
}

function ThemedApp() {
  const { isDark, theme } = useThemeContext();
  // Desktop web shows a story as a panel over the feed, so the feed stays rendered beneath it.
  const isDesktop = useIsDesktop();

  // Web only: keep the browser chrome tinted to match the app's own theme.
  // Safari/Chrome read <meta name="theme-color"> for their toolbar color;
  // expo-status-bar does nothing on web, and the generated index.html
  // ships no theme-color at all (hence white chrome in dark mode).
  // This follows the app's toggle, not the device's color scheme, and
  // updates live when the theme changes.
  //
  // FRAGILE — may break in a later iOS version. Read this before debugging
  // tint issues: Safari 26 ignores <meta name="theme-color"> in tabs
  // entirely. Instead it samples position:fixed/sticky elements near the
  // viewport edges and tints the nearest toolbar from their
  // background-color. CRRNT has no qualifying element (the tab bar is
  // absolute, content is in flow), so Safari falls back to default light
  // glass — light chrome over a dark page. The two invisible fixed strips
  // below give Safari something to sample without changing the visible
  // design: opacity:0 fixed elements are still sampled (display:none would
  // NOT be). This relies on undocumented Safari sampling behavior that
  // Apple may change; if chrome tinting stops matching the theme after an
  // iOS update, these strips are the first thing to re-check or remove.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", theme.bg);

    const mkStrip = (id: string, edge: "top" | "bottom") => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.setAttribute("aria-hidden", "true");
        el.style.position = "fixed";
        el.style.left = "0";
        el.style.right = "0";
        el.style.height = "1px";
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        el.style.zIndex = "9999";
        if (edge === "top") el.style.top = "0";
        else el.style.bottom = "0";
        document.body.appendChild(el);
      }
      el.style.backgroundColor = theme.bg;
      return el;
    };
    const top = mkStrip("crrnt-safari-tint-top", "top");
    const bottom = mkStrip("crrnt-safari-tint-bottom", "bottom");
    return () => {
      top.remove();
      bottom.remove();
    };
  }, [theme.bg]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ErrorBoundary>
            <AuthProvider>
              <QueryClientProvider client={queryClient}>
                <AuthTokenWirer />
                <AuthGate />
                <WelcomeGate />
                <PersonalizationGate />
                <NotificationTapRouter />
                <SavedStoriesProvider>
                  <AudioProvider>
                    <StatusBar style={isDark ? "light" : "dark"} />
                    <NavChromeProvider>
                      <ToastProvider>
                        <RecedingScreens>
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
                              options={
                                isDesktop
                                  ? {
                                      headerShown: false,
                                      presentation: "transparentModal",
                                      animation: "fade",
                                      contentStyle: { backgroundColor: "transparent" },
                                    }
                                  : { headerShown: false, presentation: "card" }
                              }
                            />
                            <Stack.Screen
                              name="login"
                              options={{ headerShown: false }}
                            />
                            <Stack.Screen
                              name="register"
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
                              name="privacy"
                              options={{ headerShown: false, presentation: "card" }}
                            />
                            <Stack.Screen
                              name="welcome"
                              options={{ headerShown: false, gestureEnabled: false }}
                            />
                            <Stack.Screen
                              name="personalize"
                              options={{ headerShown: false, gestureEnabled: false }}
                            />
                            <Stack.Screen
                              name="support"
                              options={{ headerShown: false, presentation: "card" }}
                            />
                            <Stack.Screen
                              name="+not-found"
                              options={{ title: "Not found" }}
                            />
                          </Stack>
                        </RecedingScreens>
                        <NowPlaying />
                        <ToastHost />
                      </ToastProvider>
                    </NavChromeProvider>
                  </AudioProvider>
                </SavedStoriesProvider>
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
    Outfit_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    registerPushToken();
    // Anonymous usage metrics: one install ping ever + a daily device
    // heartbeat. Best-effort; failures retry on the next launch.
    reportDeviceMetrics();
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
