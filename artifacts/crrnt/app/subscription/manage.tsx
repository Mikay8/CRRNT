import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Purchases, { type PurchasesOffering } from "react-native-purchases";

import { usePurchases, PRO_ENTITLEMENT } from "@/contexts/PurchasesContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STORE_LABELS: Record<string, string> = {
  APP_STORE: "App Store",
  PLAY_STORE: "Google Play",
  PROMOTIONAL: "Promotional",
  STRIPE: "Web",
  MAC_APP_STORE: "Mac App Store",
  AMAZON: "Amazon",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function productLabel(productId: string): string {
  const id = productId.toLowerCase();
  if (id.includes("annual") || id.includes("yearly") || id.includes("year")) {
    return "Yearly";
  }
  if (id.includes("monthly") || id.includes("month")) {
    return "Monthly";
  }
  return productId;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  theme,
  valueColor,
}: {
  label: string;
  value: string;
  theme: ThemeColors;
  valueColor?: string;
}) {
  return (
    <View style={dr.row}>
      <Text style={[dr.label, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[dr.value, { color: valueColor ?? theme.text }]}>{value}</Text>
    </View>
  );
}

const dr = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  label: { fontFamily: "Inter_400Regular", fontSize: 15 },
  value: { fontFamily: "Inter_500Medium", fontSize: 15 },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ManageSubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useThemeContext();
  const {
    customerInfo,
    isPro,
    presentPaywall,
    presentCustomerCenter,
    restorePurchases,
  } = usePurchases();

  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [offeringLoading, setOfferingLoading] = useState(true);

  const entitlement = customerInfo?.entitlements.active[PRO_ENTITLEMENT];
  const isCancelled = Boolean(entitlement?.unsubscribeDetectedAt);
  const hasBillingIssue = Boolean(entitlement?.billingIssueDetectedAt);

  useEffect(() => {
    Purchases.getOfferings()
      .then((o) => setOffering(o.current))
      .catch(() => {})
      .finally(() => setOfferingLoading(false));
  }, []);

  const storeDeepLink =
    Platform.OS === "ios"
      ? "https://apps.apple.com/account/subscriptions"
      : "https://play.google.com/store/account/subscriptions";

  const handleCancel = () => {
    Alert.alert(
      "Cancel subscription",
      isCancelled
        ? "Your subscription is already cancelled."
        : Platform.OS === "ios"
        ? "You'll be taken to the subscription manager to cancel. You keep access until your current billing period ends."
        : "You'll be taken to the subscription manager to cancel. You keep access until your current billing period ends.",
      [
        { text: "Go back", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: presentCustomerCenter,
        },
      ]
    );
  };

  // ── No active subscription ────────────────────────────────────────────────

  if (!isPro && !customerInfo) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <Header theme={theme} />
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </View>
    );
  }

  if (!isPro) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <Header theme={theme} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="star-outline" size={24} color={theme.textMuted} />
              <Text style={[styles.planName, { color: theme.text }]}>No active plan</Text>
            </View>
            <Text style={[styles.planSubtitle, { color: theme.textMuted }]}>
              Subscribe to CRRNT Pro to unlock unlimited stories, audio playback, and more.
            </Text>
          </View>
          <ActionButton
            label="View plans"
            icon="star"
            color={theme.accent}
            theme={theme}
            onPress={() => presentPaywall()}
          />
          <ActionButton
            label="Restore purchases"
            icon="refresh-outline"
            color={theme.textMuted}
            theme={theme}
            onPress={() => restorePurchases()}
          />
        </ScrollView>
      </View>
    );
  }

  // ── Active subscription ───────────────────────────────────────────────────

  const renewalLabel = isCancelled
    ? `Access until ${formatDate(entitlement?.expirationDate)}`
    : entitlement?.willRenew
    ? `Renews ${formatDate(entitlement?.expirationDate)}`
    : `Expires ${formatDate(entitlement?.expirationDate)}`;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <Header theme={theme} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Status card ─────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="shield-checkmark" size={22} color={theme.positive} />
            <Text style={[styles.planName, { color: theme.text }]}>CRRNT Pro</Text>
            <View style={[
              styles.statusBadge,
              { backgroundColor: (isCancelled ? theme.warning : hasBillingIssue ? theme.negative : theme.positive) + "22" },
            ]}>
              <Text style={[
                styles.statusText,
                { color: isCancelled ? theme.warning : hasBillingIssue ? theme.negative : theme.positive },
              ]}>
                {isCancelled ? "Cancelling" : hasBillingIssue ? "Billing issue" : "Active"}
              </Text>
            </View>
          </View>

          {hasBillingIssue && (
            <View style={[styles.alertBanner, { backgroundColor: theme.negative + "18", borderColor: theme.negative + "44" }]}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.negative} />
              <Text style={[styles.alertText, { color: theme.negative }]}>
                There's a billing issue with your subscription. Tap "Manage" below to resolve it.
              </Text>
            </View>
          )}

          {isCancelled && (
            <View style={[styles.alertBanner, { backgroundColor: theme.warning + "18", borderColor: theme.warning + "44" }]}>
              <Ionicons name="information-circle-outline" size={16} color={theme.warning} />
              <Text style={[styles.alertText, { color: theme.warning }]}>
                You've cancelled. Pro features remain available until your billing period ends.
              </Text>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <DetailRow
            label="Plan"
            value={productLabel(entitlement?.productIdentifier ?? "")}
            theme={theme}
          />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <DetailRow
            label={isCancelled ? "Access until" : entitlement?.willRenew ? "Next billing" : "Expires"}
            value={formatDate(entitlement?.expirationDate)}
            theme={theme}
            valueColor={isCancelled ? theme.warning : undefined}
          />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <DetailRow
            label="Purchased via"
            value={STORE_LABELS[entitlement?.store ?? ""] ?? entitlement?.store ?? "—"}
            theme={theme}
          />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <DetailRow
            label="Auto-renews"
            value={isCancelled ? "No" : entitlement?.willRenew ? "Yes" : "No"}
            theme={theme}
            valueColor={
              !isCancelled && entitlement?.willRenew ? theme.positive : theme.textMuted
            }
          />
        </View>

        {/* ── Offerings ───────────────────────────────────────────── */}
        {!offeringLoading && offering && offering.availablePackages.length > 0 && !isCancelled && (
          <>
            <SectionLabel label="Change plan" theme={theme} />
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {offering.availablePackages.map((pkg, i) => {
                const isCurrentPlan =
                  pkg.product.identifier === entitlement?.productIdentifier;
                const isLast = i === offering.availablePackages.length - 1;
                return (
                  <View key={pkg.identifier}>
                    <Pressable
                      style={[styles.packageRow, isCurrentPlan && { backgroundColor: theme.accent + "12" }]}
                      onPress={() => !isCurrentPlan && presentPaywall()}
                      disabled={isCurrentPlan}
                    >
                      <View style={styles.packageLeft}>
                        <Text style={[styles.packageLabel, { color: theme.text }]}>
                          {productLabel(pkg.product.identifier)}
                        </Text>
                        <Text style={[styles.packagePrice, { color: theme.textMuted }]}>
                          {pkg.product.priceString} / {pkg.packageType === "ANNUAL" ? "year" : "month"}
                        </Text>
                      </View>
                      {isCurrentPlan ? (
                        <View style={[styles.currentBadge, { backgroundColor: theme.accent + "22" }]}>
                          <Text style={[styles.currentBadgeText, { color: theme.accent }]}>Current</Text>
                        </View>
                      ) : (
                        <Text style={[styles.switchText, { color: theme.accent }]}>Switch</Text>
                      )}
                    </Pressable>
                    {!isLast && <View style={[styles.divider, { backgroundColor: theme.border }]} />}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* ── Actions ─────────────────────────────────────────────── */}
        <SectionLabel label="Actions" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {isCancelled ? (
            <ActionRow
              icon="star-outline"
              label="Resubscribe"
              color={theme.accent}
              theme={theme}
              onPress={() => presentPaywall()}
            />
          ) : (
            <ActionRow
              icon="settings-outline"
              label="Manage subscription"
              color={theme.text}
              theme={theme}
              onPress={presentCustomerCenter}
            />
          )}
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <ActionRow
            icon="refresh-outline"
            label="Restore purchases"
            color={theme.textMuted}
            theme={theme}
            onPress={() => restorePurchases()}
          />
        </View>

        {/* ── Cancel ──────────────────────────────────────────────── */}
        {!isCancelled && (
          <>
            <SectionLabel label="Danger zone" theme={theme} />
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: "#F8717133" }]}>
              <ActionRow
                icon="close-circle-outline"
                label="Cancel subscription"
                color={theme.negative}
                theme={theme}
                onPress={handleCancel}
              />
            </View>
            <Text style={[styles.cancelNote, { color: theme.textDim }]}>
              Cancelling stops future renewals. You keep Pro access until{" "}
              <Text style={{ color: theme.textMuted }}>{formatDate(entitlement?.expirationDate)}</Text>.
            </Text>
            <Pressable onPress={() => Linking.openURL(storeDeepLink)}>
              <Text style={[styles.storeLink, { color: theme.accent }]}>
                Or manage directly in {Platform.OS === "ios" ? "App Store" : "Google Play"} →
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Shared small components ───────────────────────────────────────────────────

function Header({ theme }: { theme: ThemeColors }) {
  return (
    <View style={[hStyles.header, { borderBottomColor: theme.border }]}>
      <Pressable onPress={() => router.back()} style={hStyles.backBtn} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={theme.accent} />
        <Text style={[hStyles.backText, { color: theme.accent }]}>Settings</Text>
      </Pressable>
      <Text style={[hStyles.title, { color: theme.text }]}>Subscription</Text>
      <View style={{ width: 70 }} />
    </View>
  );
}

const hStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, width: 70 },
  backText: { fontFamily: "Inter_500Medium", fontSize: 15 },
  title: { fontFamily: "Outfit_700Bold", fontSize: 18 },
});

function SectionLabel({ label, theme }: { label: string; theme: ThemeColors }) {
  return (
    <Text style={[styles.sectionLabel, { color: theme.textDim }]}>{label}</Text>
  );
}

function ActionButton({
  label,
  icon,
  color,
  theme,
  onPress,
}: {
  label: string;
  icon: string;
  color: string;
  theme: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionBtn,
        { backgroundColor: color, opacity: pressed ? 0.8 : 1 },
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon as any} size={18} color="#fff" />
      <Text style={styles.actionBtnText}>{label}</Text>
    </Pressable>
  );
}

function ActionRow({
  icon,
  label,
  color,
  theme,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  theme: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionRow,
        pressed && { backgroundColor: theme.surfaceHigh },
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={[styles.actionRowLabel, { color }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={theme.textDim} style={{ marginLeft: "auto" }} />
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingTop: 20 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  planName: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    flex: 1,
  },
  planSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    letterSpacing: 0.3,
  },
  alertBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginTop: 12,
  },
  alertText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  divider: { height: 1, marginVertical: 0 },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  packageRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  packageLeft: { flex: 1 },
  packageLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  packagePrice: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  currentBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  currentBadgeText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  switchText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 12,
  },
  actionBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: "#fff",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  actionRowLabel: { fontFamily: "Inter_500Medium", fontSize: 15 },
  cancelNote: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
    marginTop: 10,
  },
  storeLink: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    paddingHorizontal: 4,
    marginTop: 8,
  },
});
