/**
 * Welcome screen — first run only, native only.
 *
 * Shows once, while the OS notification permission is still undecided
 * (see WelcomeGate in app/_layout.tsx). It is the soft ask before any
 * Apple system prompt: "Turn on notifications" fires the system prompt
 * via setNotificationsEnabled; "Not now" saves the in-app opt-out so
 * startup never prompts either. Either way the screen never reappears.
 * If OS permission was already denied, the system prompt cannot be
 * shown again — the screen says so and points at device Settings, same
 * as the Settings toggle does.
 */
import { useEffect, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeContext } from "@/contexts/ThemeContext";
import { setNotificationsEnabled } from "@/lib/notifications";
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/welcome";

const LOGO = require("@/assets/images/logo.png") as number;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useThemeContext();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  // Already dismissed (e.g. deep link after first run) — don't trap the user.
  // Web never gets this screen at all: WelcomeGate skips web, and this
  // guard bounces any direct /welcome visit back to the feed.
  useEffect(() => {
    if (Platform.OS === "web") {
      router.replace("/(tabs)" as any);
      return;
    }
    hasSeenWelcome().then((seen) => {
      if (seen) router.replace("/(tabs)" as any);
    });
  }, []);

  const finish = async () => {
    await markWelcomeSeen();
    router.replace("/(tabs)" as any);
  };

  const handleTurnOn = async () => {
    setBusy(true);
    setNote(null);
    const res = await setNotificationsEnabled(true);
    setBusy(false);
    if (res.ok) {
      await finish();
      return;
    }
    if (res.reason === "permission_denied") {
      setDenied(true);
      setNote(
        "Notifications are blocked in your device settings — turn them on there, then try again.",
      );
      return;
    }
    if (res.reason === "not_device") {
      setNote("Notifications are only available in the iOS/Android app.");
      return;
    }
    setNote("Couldn't turn notifications on — check your connection and try again.");
  };

  const handleNotNow = async () => {
    // Saves the in-app opt-out, so startup registration never prompts later.
    // The user can still enable notifications from Settings at any time.
    setBusy(true);
    await setNotificationsEnabled(false);
    setBusy(false);
    await finish();
  };

  return (
    <View
      style={[
        wStyles.container,
        { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={wStyles.inner}>
        <Image
          source={LOGO}
          style={wStyles.logo}
          resizeMode="contain"
          accessibilityLabel="CRRNT"
        />
        <Text style={[wStyles.title, { color: theme.text }]}>Welcome to CRRNT</Text>
        <Text style={[wStyles.subtitle, { color: theme.textMuted }]}>
          Bite-size news without noise — fresh stories every day, gone in 7
          days.
        </Text>

        <View
          style={[
            wStyles.askCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={wStyles.askHeader}>
            <Ionicons name="notifications-outline" size={22} color={theme.accent} />
            <Text style={[wStyles.askTitle, { color: theme.text }]}>
              Stay in the loop
            </Text>
          </View>
          <Text style={[wStyles.askBody, { color: theme.textMuted }]}>
            Get the Morning Edition at 7:30am and breaking news alerts when
            editors publish them.
          </Text>
          {note ? (
            <Text style={[wStyles.note, { color: theme.textMuted }]}>{note}</Text>
          ) : null}
          {denied ? (
            <Pressable
              onPress={finish}
              style={[wStyles.primary, { backgroundColor: theme.text }]}
            >
              <Text style={[wStyles.primaryText, { color: theme.bg }]}>
                Continue to the feed
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={busy ? undefined : handleTurnOn}
                style={[
                  wStyles.primary,
                  { backgroundColor: theme.text, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text style={[wStyles.primaryText, { color: theme.bg }]}>
                  {busy ? "Turning on…" : "Turn on notifications"}
                </Text>
              </Pressable>
              <Pressable onPress={busy ? undefined : handleNotNow} style={wStyles.secondary}>
                <Text style={[wStyles.secondaryText, { color: theme.textMuted }]}>
                  Not now
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const wStyles = StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  logo: {
    width: 96,
    height: 96,
    alignSelf: "center",
    marginBottom: 28,
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 32,
    lineHeight: 38,
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 17,
    lineHeight: 25,
    marginBottom: 32,
  },
  askCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  askHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  askTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
  },
  askBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  note: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  primary: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  secondary: {
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
});
