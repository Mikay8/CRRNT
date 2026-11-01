/**
 * Streak reminder — a LOCAL notification, on purpose.
 *
 * Whether today's Feed is finished exists only on this phone (the
 * streak store is on-device guest state), so no server push can know
 * when a reminder is warranted. Instead the app keeps one local
 * notification scheduled for 8 PM: syncStreakReminder() re-evaluates
 * it on launch, when the streak state changes, and when the related
 * settings change. It fires only when ALL of these hold:
 * - the streak-reminder setting is on (default on),
 * - the master notifications preference is not off and OS permission
 *   is granted,
 * - personalization is active (streaks are a Feed feature),
 * - the user has a live streak to lose (current streak >= 1),
 * - today's Feed is not finished yet,
 * - 8 PM today is still in the future.
 * Finishing the Feed cancels tonight's reminder (recordFeedCompletion
 * in lib/streaks calls the sync).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { isNotificationsOptedOut } from "./notifications";
import { isPersonalizationActive, loadPersonalization } from "./personalization";
import { currentStreak, isDayComplete, loadStreaks, todayStr } from "./streaks";

const PREF_KEY = "crrnt.streak_reminder";
const NOTIF_ID = "streak-reminder";
export const STREAK_REMINDER_HOUR = 20;

export async function isStreakReminderEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREF_KEY)) !== "0";
  } catch {
    return true;
  }
}

export async function setStreakReminderEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {
    // Non-critical: the in-app toggle state still reflects the choice.
  }
  await syncStreakReminder();
}

export async function syncStreakReminder(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIF_ID);
  } catch {
    // Nothing scheduled — fine.
  }
  try {
    if (!(await isStreakReminderEnabled())) return;
    if (await isNotificationsOptedOut()) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;
    const prefs = await loadPersonalization();
    if (!isPersonalizationActive(prefs)) return;
    const state = await loadStreaks();
    if (currentStreak(state) < 1) return;
    if (isDayComplete(state, todayStr())) return;
    const fire = new Date();
    fire.setHours(STREAK_REMINDER_HOUR, 0, 0, 0);
    if (fire.getTime() <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID,
      content: {
        title: "Stay CRRNT",
        body: "Don't lose your streak — finish today's Feed. It takes about 4 minutes.",
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fire,
      },
    });
  } catch {
    // Reminders are best-effort; never let them break a caller.
  }
}
