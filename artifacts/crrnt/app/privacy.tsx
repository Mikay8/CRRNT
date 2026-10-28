/**
 * Privacy Policy page — public route at /privacy on web.
 *
 * This is the App Store privacy policy for CRRNT. It describes the
 * current guest-only version: no account, no ad SDK, and no
 * personalized ads. It is a standalone route, deliberately NOT added
 * to the tab bar or to any web menu.
 *
 * If accounts, subscriptions, or advertising are added in a future
 * version, this page must be updated before that version is submitted.
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
    <Text style={[pStyles.heading, { color: theme.text }]}>{children}</Text>
  );
}

function Body({
  children,
  theme,
}: {
  children: string;
  theme: ThemeColors;
}) {
  return <Text style={[pStyles.body, { color: theme.text }]}>{children}</Text>;
}

function Bullet({
  children,
  theme,
}: {
  children: string;
  theme: ThemeColors;
}) {
  return (
    <Text style={[pStyles.body, pStyles.bullet, { color: theme.text }]}>
      {"\u2022  "}
      {children}
    </Text>
  );
}

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useThemeContext();

  return (
    <View style={[pStyles.container, { backgroundColor: theme.bg }]}>
      <View
        style={[
          pStyles.header,
          { paddingTop: insets.top + 8, borderBottomColor: theme.border },
        ]}
      >
        <Pressable
          onPress={() => router.replace("/(tabs)" as any)}
          style={pStyles.backBtn}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={theme.accent} />
          <Text style={[pStyles.backText, { color: theme.accent }]}>CRRNT</Text>
        </Pressable>
        <Text style={[pStyles.headerTitle, { color: theme.text }]}>
          Privacy Policy
        </Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          pStyles.content,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={pStyles.inner}>
          <Text style={[pStyles.title, { color: theme.text }]}>
            CRRNT Privacy Policy
          </Text>
          <Text style={[pStyles.meta, { color: theme.textDim }]}>
            Effective date: 28 October 2026
          </Text>
          <Text style={[pStyles.meta, { color: theme.textDim }]}>
            Contact for privacy questions: mikayla@crrnt-news.com
          </Text>

          <Heading theme={theme}>Overview</Heading>
          <Body theme={theme}>
            CRRNT is a bite-size news app. You can use it without creating an
            account.
          </Body>
          <Body theme={theme}>
            We do not sell your personal information, we do not use it for
            advertising, and we do not track you across other apps or
            websites.
          </Body>

          <Heading theme={theme}>Information we collect</Heading>
          <Text style={[pStyles.subheading, { color: theme.text }]}>
            1. Push notification token — anonymous, server-side
          </Text>
          <Body theme={theme}>
            If you allow notifications, your device generates an Expo push
            token. That token is sent to our server and stored so we can send
            you the Morning Edition push, and breaking news pushes when an
            editor publishes one.
          </Body>
          <Body theme={theme}>
            The token is not linked to a name, email, or account, because
            CRRNT does not require an account in this version. It is used
            only to deliver notifications to your device.
          </Body>
          <Body theme={theme}>
            Retention: We keep the token until you opt out of notifications
            in the app, or until the token becomes invalid after you
            uninstall the app. Turning notifications off in Settings deletes
            the token from our server.
          </Body>

          <Text style={[pStyles.subheading, { color: theme.text }]}>
            2. Beta feedback — only if you send it
          </Text>
          <Body theme={theme}>
            If you use the Beta Feedback box in Settings, we store the
            message you write, your device platform (for example, iOS), and
            the app version.
          </Body>
          <Body theme={theme}>
            This feedback is not linked to a name, email, or account. It is
            used only to review suggestions and bug reports.
          </Body>
          <Body theme={theme}>
            Retention: We keep feedback until it has been reviewed, then
            delete it. If you include personal information in a feedback
            message by mistake, email us at the address above and we will
            remove that message.
          </Body>

          <Text style={[pStyles.subheading, { color: theme.text }]}>
            3. Anonymous usage counts — to measure installs and retention
          </Text>
          <Body theme={theme}>
            To understand how many people use CRRNT and whether they come
            back, the app sends two anonymous counts. On first launch it
            sends a single install count (day and platform only — no
            identifier). On later launches, at most once a day, it sends a
            random identifier generated on your device, which we use only
            to count returning devices and to group error reports by
            device.
          </Body>
          <Body theme={theme}>
            This identifier is not linked to your name, email, or any
            account, because CRRNT does not require an account in this
            version. It is never shared with anyone, and it is not an
            advertising identifier.
          </Body>
          <Body theme={theme}>
            Retention: We delete records for devices that have been
            inactive for 90 days. Deleting the app removes the identifier
            from your device.
          </Body>

          <Text style={[pStyles.subheading, { color: theme.text }]}>
            4. Information stored only on your device
          </Text>
          <Body theme={theme}>
            The following are stored on your device only, and are not sent
            to our server as part of an account:
          </Body>
          <Bullet theme={theme}>Stories you save</Bullet>
          <Bullet theme={theme}>Your theme preference</Bullet>
          <Bullet theme={theme}>Your notification preference</Bullet>
          <Bullet theme={theme}>Your guest status</Bullet>
          <Body theme={theme}>
            Deleting the app removes this on-device information.
          </Body>

          <Text style={[pStyles.subheading, { color: theme.text }]}>
            5. Technical information needed to deliver the app
          </Text>
          <Body theme={theme}>
            When the app fetches stories, sends a push token, or sends
            feedback, our hosting provider may receive technical information
            necessary to deliver that request, such as an IP address. We do
            not use this information to identify you, to build a profile
            about you, or for advertising.
          </Body>

          <Heading theme={theme}>
            Information we do not collect in this version
          </Heading>
          <Body theme={theme}>
            In the current guest-only version, CRRNT does not collect:
          </Body>
          <Bullet theme={theme}>Your name or email address</Bullet>
          <Bullet theme={theme}>Account credentials</Bullet>
          <Bullet theme={theme}>Precise location</Bullet>
          <Bullet theme={theme}>Contacts, photos, or health information</Bullet>
          <Bullet theme={theme}>Financial account information</Bullet>
          <Bullet theme={theme}>An advertising identifier</Bullet>
          <Bullet theme={theme}>Data for personalized advertising</Bullet>
          <Body theme={theme}>
            There is no ad SDK in this version, and there are no personalized
            ads.
          </Body>

          <Heading theme={theme}>How we use information</Heading>
          <Body theme={theme}>
            We use the information above only to provide the news feed,
            send push notifications you have allowed, review voluntary
            beta feedback, measure anonymous usage and retention, and
            improve the app.
          </Body>
          <Body theme={theme}>
            We do not use it for advertising, and we do not sell it to data
            brokers or third parties.
          </Body>

          <Heading theme={theme}>Third-party services</Heading>
          <Body theme={theme}>
            We use the following service providers to run the app. They
            process information only as described above, under their own
            policies:
          </Body>
          <Bullet theme={theme}>
            Railway — hosting and database for the CRRNT backend
          </Bullet>
          <Bullet theme={theme}>
            Expo, Apple, and Google — push notification delivery. Your
            anonymous push token is shared with the Expo push service so a
            notification can be delivered to your device.
          </Bullet>
          <Body theme={theme}>
            We do not use an analytics SDK or an advertising SDK in this
            version.
          </Body>
          <Body theme={theme}>
            Stories in CRRNT link out to publisher websites. Those publishers
            have their own privacy policies, and CRRNT is not responsible for
            their practices.
          </Body>

          <Heading theme={theme}>AI-generated summaries</Heading>
          <Body theme={theme}>
            Story summaries in CRRNT are AI-generated from public news
            stories. They are not based on your personal information, and
            they are not used to identify you.
          </Body>

          <Heading theme={theme}>Children</Heading>
          <Body theme={theme}>
            CRRNT is a general-audience news app and is not directed at
            children under 13. We do not knowingly collect personal
            information from children under 13. If you believe a child has
            provided personal information through feedback, contact us and
            we will remove it.
          </Body>

          <Heading theme={theme}>Your choices</Heading>
          <Bullet theme={theme}>
            Notifications: Turn notifications off in Settings. This deletes
            your push token from our server.
          </Bullet>
          <Bullet theme={theme}>
            Saved stories and preferences: These live on your device. Delete
            the app to remove them.
          </Bullet>
          <Bullet theme={theme}>
            Anonymous device identifier: Deleting the app removes the
            identifier from your device. Records for devices inactive for
            90 days are deleted from our server.
          </Bullet>
          <Bullet theme={theme}>
            Feedback: Email us at the address above if you want a feedback
            message you sent removed, especially if it contained personal
            information.
          </Bullet>
          <Body theme={theme}>
            Because there is no account in this version, there is no account
            to delete, and no personal data linked to you to download.
          </Body>

          <Heading theme={theme}>Changes to this policy</Heading>
          <Body theme={theme}>
            If CRRNT changes how it handles information — for example, by
            adding accounts, subscriptions, or advertising — we will update
            this policy before that version is released, and update the
            effective date above.
          </Body>

          <Heading theme={theme}>Contact</Heading>
          <Body theme={theme}>
            For privacy questions or requests, email:
            mikayla@crrnt-news.com
          </Body>
        </View>
      </ScrollView>
    </View>
  );
}

const pStyles = StyleSheet.create({
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
});
