/**
 * AuthContext — manages Supabase JWT session for the CRRNT app.
 *
 * Tokens are persisted in AsyncStorage so the user stays logged in across
 * app restarts.  All API calls that need authentication should call
 * `getAuthHeader()` to get the Authorization header.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

const TOKEN_KEY = "@crrnt/auth/access_token";
const REFRESH_KEY = "@crrnt/auth/refresh_token";
const USER_KEY = "@crrnt/auth/user";
const GUEST_KEY = "@crrnt/auth/guest_mode";

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    // Treat as expired 60s early to avoid edge-case failures
    return payload.exp * 1000 < Date.now() + 60_000;
  } catch {
    return true;
  }
}

export interface CrrntUser {
  id: string;
  email: string;
  tier: "free" | "paid";
  subscription_status: string;
  subscription_expires_at: string | null;
  onboarding_complete: boolean;
  notification_consent: boolean;
}

interface AuthContextValue {
  user: CrrntUser | null;
  accessToken: string | null;
  isGuest: boolean;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<{ requiresConfirmation: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (fields: Partial<CrrntUser>) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  getAuthHeader: () => Record<string, string>;
  enterGuestMode: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  const base = process.env.EXPO_PUBLIC_API_BASE;
  if (base) return base;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const base = getApiBase();
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CrrntUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // ── Hydrate from storage on mount ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [token, refreshToken, raw, guestFlag] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(REFRESH_KEY),
          AsyncStorage.getItem(USER_KEY),
          AsyncStorage.getItem(GUEST_KEY),
        ]);

        if (guestFlag === "1" && !token) {
          setIsGuest(true);
          return;
        }

        if (!token || !raw) return;

        if (!isTokenExpired(token)) {
          setAccessToken(token);
          setUser(JSON.parse(raw) as CrrntUser);
          return;
        }

        // Token expired — try to refresh silently
        if (!refreshToken) return;

        const res = await apiFetch("/api/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refresh_token: refreshToken }),
        });

        if (res.ok) {
          const data = await res.json();
          await Promise.all([
            AsyncStorage.setItem(TOKEN_KEY, data.session.access_token),
            AsyncStorage.setItem(REFRESH_KEY, data.session.refresh_token),
            AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user)),
          ]);
          setAccessToken(data.session.access_token);
          setUser(data.user as CrrntUser);
        } else {
          // Refresh token also expired — clear session, user must log in again
          await Promise.all([
            AsyncStorage.removeItem(TOKEN_KEY),
            AsyncStorage.removeItem(REFRESH_KEY),
            AsyncStorage.removeItem(USER_KEY),
          ]);
        }
      } catch {
        // Corrupt storage or network error — start fresh
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // ── Persist session ────────────────────────────────────────────────────────
  const _persistSession = useCallback(
    async (token: string, refresh: string, userData: CrrntUser) => {
      setAccessToken(token);
      setUser(userData);
      setIsGuest(false);
      await Promise.all([
        AsyncStorage.setItem(TOKEN_KEY, token),
        AsyncStorage.setItem(REFRESH_KEY, refresh),
        AsyncStorage.setItem(USER_KEY, JSON.stringify(userData)),
        AsyncStorage.removeItem(GUEST_KEY),
      ]);
    },
    []
  );

  const _clearSession = useCallback(async () => {
    setAccessToken(null);
    setUser(null);
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(REFRESH_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
  }, []);

  const enterGuestMode = useCallback(async () => {
    setIsGuest(true);
    await AsyncStorage.setItem(GUEST_KEY, "1");
  }, []);

  // ── Auth actions ───────────────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail ?? "Login failed");
    }
    const data = await res.json();
    await _persistSession(
      data.session.access_token,
      data.session.refresh_token ?? "",
      data.user as CrrntUser
    );
  }, [_persistSession]);

  const register = useCallback(async (email: string, password: string): Promise<{ requiresConfirmation: boolean }> => {
    const res = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail ?? "Registration failed");
    }
    const data = await res.json();
    if (data.session?.access_token) {
      await _persistSession(
        data.session.access_token,
        data.session.refresh_token ?? "",
        data.user as CrrntUser
      );
    }
    return { requiresConfirmation: !!data.requires_confirmation };
  }, [_persistSession]);

  const forgotPassword = useCallback(async (email: string): Promise<void> => {
    const res = await apiFetch("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail ?? "Request failed");
    }
  }, []);

  const logout = useCallback(async () => {
    if (accessToken) {
      await apiFetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => undefined);
    }
    await _clearSession();
  }, [accessToken, _clearSession]);

  const deleteAccount = useCallback(async () => {
    if (accessToken) {
      await apiFetch("/api/auth/account", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => undefined);
    }
    await _clearSession();
  }, [accessToken, _clearSession]);

  const updateUser = useCallback(async (fields: Partial<CrrntUser>) => {
    if (!user) return;
    const updated = { ...user, ...fields };
    setUser(updated);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
  }, [user]);

  const refreshUser = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await apiFetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.user as CrrntUser;
        setUser(updated);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
      }
    } catch {
      // Non-fatal
    }
  }, [accessToken]);

  const getAuthHeader = useCallback((): Record<string, string> => {
    if (!accessToken) return {};
    return { Authorization: `Bearer ${accessToken}` };
  }, [accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isGuest,
      hydrated,
      login,
      register,
      logout,
      refreshUser,
      updateUser,
      forgotPassword,
      getAuthHeader,
      enterGuestMode,
      deleteAccount,
    }),
    [user, accessToken, isGuest, hydrated, login, register, logout, refreshUser, updateUser, forgotPassword, getAuthHeader, enterGuestMode, deleteAccount]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
