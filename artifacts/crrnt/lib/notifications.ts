import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * In-app push notification preference (master on/off for all CRRNT pushes).
 *
 * How it works, and why each piece exists:
 * - The preference is stored on-device (AsyncStorage) because beta testers
 *   are guests — there is no user account to attach it to, and the device
 *   token IS the identity.
 * - Turning ON requests OS permission if needed, registers the Expo token
 *   with POST /api/push-token, and saves "1". If OS permission was already
 *   denied, iOS will not re-show the system prompt, so this returns
 *   "permission_denied" and the UI points the user at iOS Settings instead
 *   of pretending it worked.
 * - Turning OFF fetches the current token and deletes it server-side with
 *   DELETE /api/push-token, then saves "0". Deleting the token is what
 *   actually stops pushes even though the OS permission stays granted.
 * - Startup (registerPushToken in app/_layout.tsx) checks the saved
 *   preference first: without that check it would re-register on every
 *   launch and silently undo an explicit OFF.
 * - No stored preference yet (e.g. an install from before this toggle
 *   existed) means "follow the OS permission": granted → on, otherwise off.
 */

const PREF_KEY = "crrnt.notifications_enabled";

export type ToggleResult =
  | { ok: true }
  | { ok: false; reason: "permission_denied" | "not_device" | "network" };

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

async function getExpoToken(): Promise<string | null> {
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenData.data;
  } catch {
    return null;
  }
}

async function postToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/api/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/api/push-token`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function isNotificationsEnabled(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const stored = await AsyncStorage.getItem(PREF_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Fall through to the OS permission check.
  }
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

export async function setNotificationsEnabled(enabled: boolean): Promise<ToggleResult> {
  if (Platform.OS === "web") return { ok: false, reason: "not_device" };
  if (!Device.isDevice) return { ok: false, reason: "not_device" };

  if (enabled) {
    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let status = existing;
      if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") {
        return { ok: false, reason: "permission_denied" };
      }
    } catch {
      return { ok: false, reason: "network" };
    }
    const token = await getExpoToken();
    if (!token || !(await postToken(token))) {
      return { ok: false, reason: "network" };
    }
    await AsyncStorage.setItem(PREF_KEY, "1");
    return { ok: true };
  }

  // Disabling: delete the server-side token. If we have a token but the
  // delete fails, report the error and leave the preference alone — saving
  // "0" while the token is still subscribed would claim pushes stopped
  // when they have not. If no token can be fetched (e.g. OS permission was
  // already revoked, so nothing is deliverable anyway), saving "0" is safe
  // and stops startup from re-registering.
  const token = await getExpoToken();
  if (token && !(await deleteToken(token))) {
    return { ok: false, reason: "network" };
  }
  await AsyncStorage.setItem(PREF_KEY, "0");
  return { ok: true };
}

export async function isNotificationsOptedOut(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREF_KEY)) === "0";
  } catch {
    return false;
  }
}
