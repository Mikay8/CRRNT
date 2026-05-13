/**
 * PurchasesContext — RevenueCat SDK integration.
 *
 * Handles SDK configuration, user identity sync, customer info tracking,
 * paywall presentation, and purchase restoration.
 *
 * The SDK is configured once on mount; user identity is kept in sync with
 * the Supabase auth state (Purchases.logIn / logOut mirror AuthContext).
 *
 * In Expo Go the SDK automatically falls back to Preview API Mode (mock
 * purchases). A real dev build is required for actual store transactions.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
} from "react-native-purchases";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";

import { useAuth } from "./AuthContext";

// ── Constants ─────────────────────────────────────────────────────────────────

const RC_API_KEY =
  process.env.EXPO_PUBLIC_RC_API_KEY ?? "";

export const PRO_ENTITLEMENT = "CRRNT Pro";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PurchasesContextValue {
  /** Full RevenueCat customer info — null while loading. */
  customerInfo: CustomerInfo | null;
  /** True when the user has an active "CRRNT Pro" entitlement. */
  isPro: boolean;
  /** True while the initial customer info fetch is in flight. */
  loading: boolean;
  /**
   * Present the RevenueCat paywall. Optionally target a specific offering
   * by its identifier (falls back to current offering).
   * Returns true if the user purchased or restored during this session.
   */
  presentPaywall: (offeringId?: string) => Promise<boolean>;
  /**
   * Present the paywall only if the user does not already have CRRNT Pro.
   * Returns true if the user now has access (purchased, restored, or already had it).
   */
  presentPaywallIfNeeded: () => Promise<boolean>;
  /**
   * Present the RevenueCat Customer Center (subscription management UI).
   * Available on Pro/Enterprise RC plans; silently fails otherwise.
   */
  presentCustomerCenter: () => Promise<void>;
  /**
   * Restore previous purchases. Returns true if the user now has CRRNT Pro.
   * Shows a confirmation alert on success/failure.
   */
  restorePurchases: () => Promise<boolean>;
  /** Manually refresh customer info from RevenueCat's servers. */
  refreshCustomerInfo: () => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const PurchasesContext = createContext<PurchasesContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function PurchasesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = useRef(false);
  const loggedInUserId = useRef<string | null>(null);

  // ── Configure SDK once on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (configured.current) return;
    configured.current = true;

    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    Purchases.configure({ apiKey: RC_API_KEY });

    // Real-time listener — fires on any purchase, restoration, or expiry event
    const removeListener = Purchases.addCustomerInfoUpdateListener(
      (info) => setCustomerInfo(info)
    );

    Purchases.getCustomerInfo()
      .then((info) => setCustomerInfo(info))
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => {
      removeListener();
    };
  }, []);

  // ── Sync RC user identity with Supabase auth ────────────────────────────────
  useEffect(() => {
    if (!configured.current) return;

    if (user?.id && user.id !== loggedInUserId.current) {
      loggedInUserId.current = user.id;
      Purchases.logIn(user.id)
        .then(({ customerInfo: info }) => {
          setCustomerInfo(info);
          // Stamp the user profile with attributes visible in the RC dashboard.
          // These are set for every user — free or paid — so you can filter and
          // segment non-subscribers in RC Analytics.
          if (user.email) Purchases.setEmail(user.email);
          Purchases.setAttributes({
            tier: user.tier ?? "free",
            // ISO string so RC can display it as a date in the dashboard
            created_at: new Date().toISOString(),
          });
        })
        .catch(() => {});
    } else if (!user && loggedInUserId.current !== null) {
      loggedInUserId.current = null;
      Purchases.logOut()
        .then((info) => setCustomerInfo(info))
        .catch(() => {});
    }
  }, [user?.id, user]);

  // ── Derived state ────────────────────────────────────────────────────────────

  // Fall back to Supabase tier so content gating works in Expo Go / dev builds
  // where RevenueCat runs in Preview Mode and entitlements may not be populated.
  const isPro = Boolean(
    customerInfo?.entitlements.active[PRO_ENTITLEMENT] ||
    user?.tier === "paid"
  );

  // ── Actions ──────────────────────────────────────────────────────────────────

  const presentPaywall = useCallback(
    async (offeringId?: string): Promise<boolean> => {
      try {
        let result: PAYWALL_RESULT;

        if (offeringId) {
          const offerings = await Purchases.getOfferings();
          const offering =
            offerings.all[offeringId] ?? offerings.current ?? undefined;
          result = await RevenueCatUI.presentPaywall({ offering });
        } else {
          result = await RevenueCatUI.presentPaywall();
        }

        return (
          result === PAYWALL_RESULT.PURCHASED ||
          result === PAYWALL_RESULT.RESTORED
        );
      } catch {
        return false;
      }
    },
    []
  );

  const presentPaywallIfNeeded = useCallback(async (): Promise<boolean> => {
    if (isPro) return true;
    try {
      const result = await RevenueCatUI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: PRO_ENTITLEMENT,
      });
      return (
        result === PAYWALL_RESULT.PURCHASED ||
        result === PAYWALL_RESULT.RESTORED ||
        result === PAYWALL_RESULT.NOT_PRESENTED // already had access
      );
    } catch {
      return false;
    }
  }, [isPro]);

  const presentCustomerCenter = useCallback(async (): Promise<void> => {
    try {
      await RevenueCatUI.presentCustomerCenter();
    } catch {
      // Customer Center unavailable on this RC plan — surface a fallback
      Alert.alert(
        "Manage subscription",
        "Visit your device's subscription settings to manage your CRRNT Pro plan.",
        [{ text: "OK" }]
      );
    }
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    try {
      const info = await Purchases.restorePurchases();
      setCustomerInfo(info);
      const hasPro = Boolean(info.entitlements.active[PRO_ENTITLEMENT]);
      if (hasPro) {
        Alert.alert(
          "Purchases restored",
          "Your CRRNT Pro subscription has been restored.",
          [{ text: "Great!" }]
        );
      } else {
        Alert.alert(
          "Nothing to restore",
          "We couldn't find any active CRRNT Pro subscription linked to your account.",
          [{ text: "OK" }]
        );
      }
      return hasPro;
    } catch {
      Alert.alert("Restore failed", "Please try again.", [{ text: "OK" }]);
      return false;
    }
  }, []);

  const refreshCustomerInfo = useCallback(async (): Promise<void> => {
    try {
      const info = await Purchases.getCustomerInfo();
      setCustomerInfo(info);
    } catch {}
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────────

  const value = useMemo<PurchasesContextValue>(
    () => ({
      customerInfo,
      isPro,
      loading,
      presentPaywall,
      presentPaywallIfNeeded,
      presentCustomerCenter,
      restorePurchases,
      refreshCustomerInfo,
    }),
    [
      customerInfo,
      isPro,
      loading,
      presentPaywall,
      presentPaywallIfNeeded,
      presentCustomerCenter,
      restorePurchases,
      refreshCustomerInfo,
    ]
  );

  return (
    <PurchasesContext.Provider value={value}>
      {children}
    </PurchasesContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePurchases(): PurchasesContextValue {
  const ctx = useContext(PurchasesContext);
  if (!ctx) {
    throw new Error("usePurchases must be used inside <PurchasesProvider>");
  }
  return ctx;
}
