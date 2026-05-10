/**
 * SubscriptionContext — tracks RevenueCat subscription status.
 *
 * Links the RevenueCat customer ID to the backend after purchase so that
 * the server can process webhook events correctly.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "./AuthContext";

interface SubscriptionState {
  tier: "free" | "paid";
  status: string;
  expiresAt: string | null;
  loading: boolean;
}

interface SubscriptionContextValue extends SubscriptionState {
  identify: (revenuecatCustomerId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  const base = process.env.EXPO_PUBLIC_API_BASE;
  if (base) return base;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function SubscriptionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { accessToken, user, refreshUser } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    tier: "free",
    status: "none",
    expiresAt: null,
    loading: false,
  });

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`${getApiBase()}/api/subscriptions/status`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      if (res.ok) {
        const data = await res.json();
        setState({
          tier: data.tier ?? "free",
          status: data.subscription_status ?? "none",
          expiresAt: data.subscription_expires_at ?? null,
          loading: false,
        });
        await refreshUser();
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [accessToken, refreshUser]);

  const identify = useCallback(
    async (revenuecatCustomerId: string) => {
      if (!accessToken) return;
      await fetch(`${getApiBase()}/api/subscriptions/revenuecat/identify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ revenuecat_customer_id: revenuecatCustomerId }),
      }).catch(() => undefined);
      await refresh();
    },
    [accessToken, refresh]
  );

  useEffect(() => {
    if (accessToken) {
      refresh().catch(() => undefined);
    }
  }, [accessToken]);

  useEffect(() => {
    if (user) {
      setState((s) => ({
        ...s,
        tier: user.tier ?? "free",
        status: user.subscription_status ?? "none",
        expiresAt: user.subscription_expires_at ?? null,
      }));
    }
  }, [user]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({ ...state, identify, refresh }),
    [state, identify, refresh]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx)
    throw new Error("useSubscription must be used inside <SubscriptionProvider>");
  return ctx;
}
