/**
 * Support page — public route at /support on web.
 *
 * This is the App Store Support URL page for CRRNT. It is a
 * standalone route, deliberately NOT added to the tab bar or to any
 * web menu, following the same pattern as the Privacy Policy page.
 *
 * Keep this page accurate for the current guest-only version: no
 * account, no account deletion or recovery, stories last 7 days.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";

function Heading({
  children,
  theme,
}: {
  children: string;
  theme: ThemeColors;
}) {
  return (
    <Text style={[sStyles.heading, { color: theme.text }]}>{children}</Text>
  );
}

function Body({
  children,
  theme,
}: {
  children: string;
  theme: ThemeColors;
}) {
  return <Text style={[sStyles.body, { color: theme.text }]}>{children}</Text>;
}

function Bullet({
  children,
  theme,
}: {
  children: string;
  theme: ThemeColors;
}) {
  return (
    <Text style={[sStyles.body, sStyles.bullet, { color: theme.text }]}>
      {"\u2022  "}
      {children}
    </Text>
  );
}

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useThemeContext();

  return (
    <View style={[sStyles.container, { backgroundColor: theme.bg }]}>
      <View
        style={[
          sStyles.header,
          { paddingTop: insets.top + 8, borderBottomColor: theme.border },
        ]}
      >
        <Pressable
          onPress={() => router.replace("/(tabs)" as any)}
          style={sStyles.backBtn}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={theme.accent} />
          <Text style={[sStyles.backText, { color: theme.accent }]}>CRRNT</Text>
        </Pressable>
        <Text style={[sStyles.headerTitle, { color: theme.text }]}>Support</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          sStyles.content,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={sStyles.inner}>
          <Text style={[sStyles.title, { color: theme.text }]}>
            CRRNT Support
          </Text>
          <Text style={[sStyles.meta, { color: theme.textDim }]}>
            Last updated: 28 October 2026
          </Text>

          <Body theme={theme}>
            CRRNT is a bite-size news app. Every day, trending stories are
            boiled down to short summaries that get straight to the point.
            Stories only stay for seven days, so your feed is always fresh.
          </Body>

          <Heading theme={theme}>How to get help</Heading>
          <Body theme={theme}>
            Email us at mikayla@crrnt-news.com. That is the best way to
            reach us with a question, a bug report, or a problem with the
            app.
          </Body>
          <Body theme={theme}>
            You can also send feedback from inside the app: go to Settings
            and use the Beta Feedback box to share a suggestion or report
            a bug.
          </Body>

          <Heading theme={theme}>Frequently asked questions</Heading>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            Is CRRNT free?
          </Text>
          <Body theme={theme}>Yes, CRRNT is free to use.</Body>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            Do I need an account?
          </Text>
          <Body theme={theme}>
            No. CRRNT works without an account. You use it as a guest, and
            there is no account to sign up for, recover, or delete in this
            version.
          </Body>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            How long do stories stay?
          </Text>
          <Body theme={theme}>
            Stories only stay for seven days. After that they are removed,
            so your feed stays fresh.
          </Body>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            How do I save a story?
          </Text>
          <Body theme={theme}>
            Save a story in the app and find it later in the Saved tab.
            Saved stories are stored on your device. Deleting the app
            removes them.
          </Body>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            How do I read the full article?
          </Text>
          <Body theme={theme}>
            Open a story and follow the link to the original publisher.
            CRRNT shows a short summary; the full article lives on the
            publisher&apos;s website.
          </Body>

          <Heading theme={theme}>Troubleshooting</Heading>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            The feed is not loading
          </Text>
          <Bullet theme={theme}>
            Check your internet connection, then pull down to refresh the
            feed or restart the app.
          </Bullet>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            Audio will not play
          </Text>
          <Bullet theme={theme}>
            Check your volume and make sure your device is not on silent.
          </Bullet>
          <Bullet theme={theme}>
            Try another story, then restart the app if audio still does
            not play.
          </Bullet>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            I am not getting notifications
          </Text>
          <Bullet theme={theme}>
            Check the notifications toggle in the app&apos;s Settings.
          </Bullet>
          <Bullet theme={theme}>
            Then check iOS Settings, Notifications, CRRNT, and make sure
            Allow Notifications is on.
          </Bullet>
          <Bullet theme={theme}>
            Turning notifications off in the app deletes your push token
            from our server.
          </Bullet>

          <Text style={[sStyles.subheading, { color: theme.text }]}>
            A story disappeared
          </Text>
          <Body theme={theme}>
            Stories are removed after seven days. If a story is older than
            that, it will no longer be in the feed, even if you saw it
            before — unless you saved it.
          </Body>

          <Heading theme={theme}>Privacy</Heading>
          <Body theme={theme}>
            For how CRRNT handles your information, see our Privacy
            Policy.
          </Body>
          <Pressable
            onPress={() => router.replace("/privacy" as any)}
            hitSlop={8}
          >
            <Text style={[sStyles.link, { color: theme.accent }]}>
              https://www.crrnt-news.com/privacy
            </Text>
          </Pressable>

          <Heading theme={theme}>Contact</Heading>
          <Body theme={theme}>
            For support, email: mikayla@crrnt-news.com
          </Body>
        </View>
      </ScrollView>
    </View>
  );
}

const sStyles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, width: 70 },
  backText: { fontFamily: "Inter_500Medium", fontSize: 15 },
  headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 18 },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  inner: { width: "100%", maxWidth: 720, alignSelf: "center" },
  title: { fontFamily: "Outfit_700Bold", fontSize: 26, marginBottom: 8 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 14, marginBottom: 4 },
  heading: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    marginTop: 28,
    marginBottom: 10,
  },
  subheading: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    marginTop: 18,
    marginBottom: 8,
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
  },
  bullet: { marginBottom: 6, paddingLeft: 8 },
  link: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    marginBottom: 12,
  },
});
