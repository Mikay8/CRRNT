/**
 * Internal product analytics — events go to CRRNT's own backend.
 *
 * This replaces the short-lived PostHog integration: events are POSTed to
 * the backend's /api/metrics/event endpoint and stored in CRRNT's own
 * database, where the admin portal's Analytics page reads them. Nothing
 * is sent to a third-party analytics service.
 *
 * Events are keyed only by the same random on-device UUID the usage
 * metrics already use (lib/deviceMetrics), never joined to a name,
 * email, or account. Devices marked internal (the owner's test devices)
 * are flagged on every event so the dashboard can exclude them from
 * headline counts.
 *
 * Like the metrics pings, capture is best-effort and must never break
 * the app: failures are swallowed and the event is simply lost.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

import { getApiBase, getDeviceId, isInternalDevice } from "./deviceMetrics";

// The event names the backend whitelists (see /api/metrics/event in the
// API server). Anything else is ignored server-side.
const KNOWN_EVENTS = new Set([
  "story_opened",
  "story_completed",
  "story_played",
  "story_saved",
  "story_unsaved",
  "story_shared",
  "feed_filter_selected",
]);

function platform(): string {
  return Platform.OS === "ios" || Platform.OS === "android"
    ? Platform.OS
    : "web";
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? "unknown";
}

let deviceIdPromise: Promise<string> | null = null;
function deviceId(): Promise<string> {
  if (!deviceIdPromise) deviceIdPromise = getDeviceId();
  return deviceIdPromise;
}

async function postEvent(
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const base = getApiBase();
  if (!base) return;
  await fetch(`${base}/api/metrics/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_id: await deviceId(),
      event,
      story_id:
        typeof properties?.story_id === "string" ? properties.story_id : null,
      category:
        typeof properties?.category === "string" ? properties.category : null,
      platform: platform(),
      app_version: appVersion(),
      internal: await isInternalDevice(),
    }),
  });
}

/**
 * Send one event to CRRNT's backend. Fire-and-forget: returns
 * immediately and never throws. Only the fields the backend stores are
 * sent (story_id / category are pulled out of properties).
 */
export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!KNOWN_EVENTS.has(event)) return;
  void (async () => {
    try {
      await postEvent(event, properties);
    } catch {
      // Analytics must never break the app.
    }
  })();
}

/** Screen view: one per route change, stored as event "screen_view". */
export function captureScreen(_pathname: string): void {
  void (async () => {
    try {
      await postEvent("screen_view");
    } catch {
      // Analytics must never break the app.
    }
  })();
}
