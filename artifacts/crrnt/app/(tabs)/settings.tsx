import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePurchases } from "@/contexts/PurchasesContext";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierColor(isPro: boolean): string {
  return isPro ? "#10B981" : "#F59E0B";
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { isDark, theme, toggleTheme } = useThemeContext();
  const { user, logout, forgotPassword, accessToken } = useAuth();
  const {
    isPro,
    customerInfo,
    presentPaywall,
    presentCustomerCenter,
    restorePurchases,
  } = usePurchases();
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [dialog, setDialog] = useState<{
    title: string;
    message?: string;
    buttons: AlertButton[];
  } | null>(null);
  const closeDialog = () => setDialog(null);

  const { data: quizData } = useGetOnboardingQuiz();
  const prefs = quizData?.preferences;

  const interestsSummary = prefs?.interests?.length
    ? prefs.interests.join(", ")
    : "Not set";

  const getApiBase = () => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (domain) return `https://${domain}`;
    return process.env.EXPO_PUBLIC_API_BASE ?? "";
  };

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
        await fetch(`${getApiBase()}/api/auth/account`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken ?? ""}` },
        });
        await logout();
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
            <View style={[styles.tierBadge, { backgroundColor: tierColor(isPro) + "22" }]}>
              <Text style={[styles.tierText, { color: tierColor(isPro) }]}>
                {isPro ? "Pro" : "Free"}
              </Text>
            </View>
          </View>
          {!isPro && (
            <Pressable
              style={[styles.upgradeBtn, { backgroundColor: theme.accent }]}
              onPress={() => presentPaywall()}
            >
              <Text style={styles.upgradeBtnText}>Upgrade</Text>
            </Pressable>
          )}
        </View>

        {/* ── Subscription ──────────────────────────────────────────── */}
        <SectionHeader label="Subscription" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {isPro ? (
            <>
              <Row
                icon="shield-checkmark-outline"
                label="CRRNT Pro"
                value={
                  customerInfo?.entitlements.active["CRRNT Pro"]?.expirationDate
                    ? `Renews ${new Date(customerInfo.entitlements.active["CRRNT Pro"].expirationDate).toLocaleDateString()}`
                    : "Active"
                }
                theme={theme}
              />
              <Row
                icon="settings-outline"
                label="Manage subscription"
                onPress={() => router.push("/subscription/manage" as any)}
                theme={theme}
              />
            </>
          ) : (
            <Row
              icon="star-outline"
              label="Upgrade to CRRNT Pro"
              value="Unlimited stories, audio & more"
              onPress={() => router.push("/subscription/manage" as any)}
              theme={theme}
            />
          )}
          <Row
            icon="refresh-outline"
            label={restoring ? "Restoring…" : "Restore purchases"}
            onPress={
              restoring
                ? undefined
                : async () => {
                    setRestoring(true);
                    await restorePurchases();
                    setRestoring(false);
                  }
            }
            theme={theme}
            last
          />
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
  tierBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  tierText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    letterSpacing: 0.4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  upgradeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  upgradeBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: "#fff",
  },
});
