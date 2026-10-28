/**
 * Anonymous usage metrics — one install ping, one daily device heartbeat.
 *
 * Privacy design (see privacy policy):
 * - The install ping carries NO identifier at all. The server only bumps
 *   an aggregate daily counter (date + platform + count).
 * - The device heartbeat carries a single random UUID generated on this
 *   device. It is not derived from hardware, not the advertising ID, and
 *   never joined to any account, name, email, or IP. It exists so the
 *   server can measure retention (first_seen / last_seen) and correlate
 *   error reports to a device without knowing who owns it.
 * - Both pings are best-effort and must never break launch: on failure
 *   the flags stay unset and the next launch retries.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

const DEVICE_ID_KEY = "@crrnt/device-id/v1";
const INSTALL_COUNTED_KEY = "@crrnt/install-counted/v1";
const LAST_DEVICE_PING_KEY = "@crrnt/last-device-ping/v1";

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

function uuidv4(): string {
  // Random identifier only — unpredictability is not a security property
  // here, so Math.random is an acceptable fallback when crypto is absent.
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const id = uuidv4();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

function platform(): string {
  return Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? "unknown";
}

/** Returns true only on a 2xx response, so callers can retry on failure. */
async function post(path: string, body: object): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Call once on app startup. Sends at most one install ping ever, and a
 * device heartbeat at most once per day. Silent on failure — flags are
 * only set after a successful post, so the next launch retries.
 */
export async function reportDeviceMetrics(): Promise<void> {
  try {
    const counted = await AsyncStorage.getItem(INSTALL_COUNTED_KEY);
    if (!counted) {
      const ok = await post("/api/metrics/install", {
        platform: platform(),
        app_version: appVersion(),
      });
      if (ok) await AsyncStorage.setItem(INSTALL_COUNTED_KEY, "1");
    }

    const today = new Date().toISOString().slice(0, 10);
    const lastPing = await AsyncStorage.getItem(LAST_DEVICE_PING_KEY);
    if (lastPing !== today) {
      const deviceId = await getDeviceId();
      const ok = await post("/api/metrics/device", {
        device_id: deviceId,
        platform: platform(),
        app_version: appVersion(),
      });
      if (ok) await AsyncStorage.setItem(LAST_DEVICE_PING_KEY, today);
    }
  } catch {
    // Metrics must never break launch.
  }
}
