/**
 * PostHog product analytics — privacy-clean by design.
 *
 * Why a hand-rolled client instead of the PostHog SDK: everything CRRNT
 * needs is custom events (story opened / played / completed, filter and
 * save taps) plus screen views and retention. PostHog ingests those over
 * a plain HTTPS POST, so no SDK, no native module, and no new EAS build
 * requirement beyond the JS bundle. There is deliberately NO autocapture,
 * NO session recording, and NO identify() — events are keyed only by the
 * same random on-device UUID the usage metrics already use
 * (lib/deviceMetrics), never joined to a name, email, or account.
 *
 * Configuration comes from the environment at build/export time:
 *   EXPO_PUBLIC_POSTHOG_KEY   the project's public phc_ key
 *   EXPO_PUBLIC_POSTHOG_HOST  ingest host (default US cloud)
 * With no key set, every call is a no-op, so dev builds and any build
 * made before the key is provisioned stay completely silent.
 *
 * Like the metrics pings, capture is best-effort and must never break
 * the app: failures are swallowed.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

import { getDeviceId } from "./deviceMetrics";

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "";
const POSTHOG_HOST = (
  process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"
).replace(/\/+$/, "");

function platform(): string {
  return Platform.OS === "ios" || Platform.OS === "android"
    ? Platform.OS
    : "web";
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? "unknown";
}

let distinctIdPromise: Promise<string> | null = null;
function distinctId(): Promise<string> {
  if (!distinctIdPromise) distinctIdPromise = getDeviceId();
  return distinctIdPromise;
}

/**
 * Send one event to PostHog. Fire-and-forget: returns immediately, never
 * throws, and silently does nothing when no key is configured.
 */
export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!POSTHOG_KEY) return;
  void (async () => {
    try {
      const deviceId = await distinctId();
      await fetch(`${POSTHOG_HOST}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: POSTHOG_KEY,
          event,
          distinct_id: deviceId,
          properties: {
            platform: platform(),
            app_version: appVersion(),
            $lib: "crrnt-fetch",
            ...properties,
          },
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      // Analytics must never break the app.
    }
  })();
}

/** Screen view: $pageview on web, $screen on native (PostHog convention). */
export function captureScreen(pathname: string): void {
  if (Platform.OS === "web") {
    capture("$pageview", { $current_url: pathname });
  } else {
    capture("$screen", { $screen_name: pathname });
  }
}
