import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useGetOnboardingQuiz } from "@workspace/api-client-react";
import type { ThemeColors } from "@/constants/theme";
import { AlertDialog, type AlertButton } from "@/components/AlertDialog";

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label, theme }: { label: string; theme: ThemeColors }) {
  return (
    <Text style={[sectionHeaderStyle, { color: theme.textDim }]}>{label}</Text>
  );
}

const sectionHeaderStyle: object = {
  fontFamily: "Inter_600SemiBold",
  fontSize: 11,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  marginBottom: 6,
  marginTop: 24,
  paddingHorizontal: 4,
};

interface RowProps {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  destructive?: boolean;
  theme: ThemeColors;
  last?: boolean;
}

function Row({ icon, label, value, onPress, right, destructive, theme, last }: RowProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={!onPress && !right}
      style={[
        rowStyles.row,
        { borderBottomColor: theme.border, borderBottomWidth: last ? 0 : 1 },
        pressed && { backgroundColor: theme.surfaceHigh },
      ]}
    >
      <View style={rowStyles.iconWrap}>
        <Ionicons
          name={icon as any}
          size={18}
          color={destructive ? "#F87171" : theme.accent}
        />
      </View>
      <View style={rowStyles.body}>
        <Text
          style={[
            rowStyles.label,
            { color: destructive ? "#F87171" : theme.text },
          ]}
        >
          {label}
        </Text>
        {value ? (
          <Text style={[rowStyles.value, { color: theme.textMuted }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      {right ? (
        right
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={16} color={theme.textDim} />
      ) : null}
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 54,
  },
  iconWrap: {
    width: 30,
    alignItems: "center",
    marginRight: 12,
  },
  body: { flex: 1 },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  value: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 2,
  },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { isDark, theme, toggleTheme } = useThemeContext();
  const { user, logout, forgotPassword, accessToken, isGuest, sendVerificationEmail, deleteAccount } = useAuth();
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dialog, setDialog] = useState<{
    title: string;
    message?: string;
    buttons: AlertButton[];
  } | null>(null);

  const { data: quizData } = useGetOnboardingQuiz();

  const handleSendVerification = async () => {
    setSendingVerification(true);
    await sendVerificationEmail();
    setSendingVerification(false);
    setVerificationSent(true);
  };

  if (isGuest || !user) {
    return <Redirect href={"/login" as any} />;
  }

  const closeDialog = () => setDialog(null);

  const prefs = quizData?.preferences;

  const interestsSummary = prefs?.interests?.length
    ? prefs.interests.join(", ")
    : "Not set";

  const handleChangePassword = () => {
    if (!user?.email) return;

    const doSend = async () => {
      closeDialog();
      try {
        await forgotPassword(user.email);
        setDialog({
          title: "Email sent",
          message: "Check your inbox for the reset link.",
          buttons: [{ text: "OK", onPress: closeDialog }],
        });
      } catch {
        setDialog({
          title: "Error",
          message: "Could not send reset email. Try again.",
          buttons: [{ text: "OK", onPress: closeDialog }],
        });
      }
    };

    setDialog({
      title: "Change password",
      message: `We'll send a reset link to ${user.email}.`,
      buttons: [
        { text: "Cancel", style: "cancel", onPress: closeDialog },
        { text: "Send link", onPress: doSend },
      ],
    });
  };

  const handleSignOut = () => {
    const doSignOut = async () => {
      closeDialog();
      setSigningOut(true);
      await logout();
      setSigningOut(false);
    };

    setDialog({
      title: "Sign out",
      message: "Are you sure you want to sign out?",
      buttons: [
        { text: "Cancel", style: "cancel", onPress: closeDialog },
        { text: "Sign out", style: "destructive", onPress: doSignOut },
      ],
    });
  };

  const handleDeleteAccount = () => {
    const doDelete = async () => {
      closeDialog();
      setDeleting(true);
      try {
        await deleteAccount();
      } catch {
        setDialog({
          title: "Error",
          message: "Could not delete account. Please try again or contact support.",
          buttons: [{ text: "OK", onPress: closeDialog }],
        });
      } finally {
        setDeleting(false);
      }
    };

    const confirmDelete = () => {
      setDialog({
        title: "Are you absolutely sure?",
        message: "Your stories, preferences, and subscription will be removed immediately.",
        buttons: [
          { text: "Cancel", style: "cancel", onPress: closeDialog },
          { text: "Yes, delete everything", style: "destructive", onPress: doDelete },
        ],
      });
    };

    setDialog({
      title: "Delete account",
      message: "This will permanently delete your account and all associated data. This cannot be undone.",
      buttons: [
        { text: "Cancel", style: "cancel", onPress: closeDialog },
        { text: "Delete account", style: "destructive", onPress: confirmDelete },
      ],
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <AlertDialog
        visible={dialog !== null}
        title={dialog?.title ?? ""}
        message={dialog?.message}
        buttons={dialog?.buttons ?? []}
      />
      <Text style={[styles.screenTitle, { color: theme.text }]}>Settings</Text>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Email verification banner ──────────────────────────────── */}
        {user.email_verified === false && (
          <View style={bannerStyles.banner}>
            <Ionicons name="mail-unread-outline" size={20} color="#92400E" style={{ marginTop: 1 }} />
            <View style={bannerStyles.body}>
              <Text style={bannerStyles.title}>Verify your email</Text>
              <Text style={bannerStyles.subtitle}>
                {verificationSent
                  ? "Email sent — check your inbox and click the link."
                  : "Check your inbox for a verification link."}
              </Text>
            </View>
            {!verificationSent && (
              <Pressable
                onPress={handleSendVerification}
                disabled={sendingVerification}
                style={bannerStyles.btn}
              >
                {sendingVerification ? (
                  <ActivityIndicator size="small" color="#92400E" />
                ) : (
                  <Text style={bannerStyles.btnText}>Resend</Text>
                )}
              </Pressable>
            )}
          </View>
        )}

        {/* ── Account card ──────────────────────────────────────────── */}
        <View style={[styles.accountCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.avatar, { backgroundColor: theme.surfaceHigh }]}>
            <Text style={[styles.avatarText, { color: theme.accent }]}>
              {user?.email?.[0]?.toUpperCase() ?? "?"}
            </Text>
          </View>
          <View style={styles.accountInfo}>
            <Text style={[styles.accountEmail, { color: theme.text }]} numberOfLines={1}>
              {user?.email ?? "—"}
            </Text>
          </View>
        </View>

        {/* ── Personalization ───────────────────────────────────────── */}
        <SectionHeader label="Personalization" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row
            icon="flash-outline"
            label="Interests"
            value={interestsSummary}
            onPress={() => router.push("/settings/preferences" as any)}
            theme={theme}
          />
          <Row
            icon="options-outline"
            label="Edit all preferences"
            onPress={() => router.push("/settings/preferences" as any)}
            theme={theme}
            last
          />
        </View>

        {/* ── Appearance ────────────────────────────────────────────── */}
        <SectionHeader label="Appearance" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row
            icon="moon-outline"
            label="Dark mode"
            theme={theme}
            last
            right={
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: theme.border, true: theme.accentDim }}
                thumbColor={isDark ? theme.accent : theme.textDim}
              />
            }
          />
        </View>

        {/* ── Security ──────────────────────────────────────────────── */}
        <SectionHeader label="Security" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row
            icon="key-outline"
            label="Change password"
            onPress={handleChangePassword}
            theme={theme}
            last
          />
        </View>

        {/* ── Sign out ──────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 24 }]}>
          <Row
            icon="log-out-outline"
            label={signingOut ? "Signing out…" : "Sign out"}
            onPress={signingOut ? undefined : handleSignOut}
            theme={theme}
            last
          />
        </View>

        {/* ── Danger zone ───────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: "#F8717122", marginTop: 8 }]}>
          <Row
            icon="trash-outline"
            label={deleting ? "Deleting account…" : "Delete account"}
            onPress={deleting ? undefined : handleDeleteAccount}
            theme={theme}
            destructive
            last
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screenTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  content: { paddingHorizontal: 16 },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginTop: 8,
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
  },
  accountInfo: { flex: 1, gap: 6 },
  accountEmail: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
});

const bannerStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FCD34D",
    padding: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  body: { flex: 1 },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#92400E",
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#92400E",
    marginTop: 2,
    lineHeight: 18,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D97706",
    minWidth: 60,
    alignItems: "center",
  },
  btnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#92400E",
  },
});
