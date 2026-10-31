import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";
import {
  isNotificationsEnabled,
  setNotificationsEnabled,
} from "../../lib/notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useChromeBottomPadding } from "@/contexts/NavChromeContext";
import { useIsDesktop } from "@/hooks/useLayoutMode";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { KeyboardDismissBar } from "@/components/KeyboardDismissBar";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetOnboardingQuiz,
  useListStories,
  type Story,
} from "@workspace/api-client-react";
import type { ThemeColors } from "@/constants/theme";
import { AUTH_ENABLED } from "@/constants/features";
import { AlertDialog, type AlertButton } from "@/components/AlertDialog";
import {
  isPersonalizationActive,
  personalizedFeed,
  savePersonalization,
  usePersonalization,
} from "@/lib/personalization";
import {
  addDays,
  currentStreak,
  finishedOn,
  isDayComplete,
  monthStats,
  recordFeedCompletion,
  todayStr,
  useStreaks,
} from "@/lib/streaks";
import {
  isStreakReminderEnabled,
  setStreakReminderEnabled,
  syncStreakReminder,
} from "@/lib/streak-reminder";
import { useAudio } from "@/contexts/AudioContext";
import { CATEGORIES } from "@/constants/categories";

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

// ── Notifications toggle ──────────────────────────────────────────────────────
// Master on/off for all CRRNT pushes. Native only — the parent renders this
// section only when Platform.OS !== "web", since Expo push does not exist
// on web. Logic lives in lib/notifications.ts; this is just the switch.
function NotificationsSection({ theme }: { theme: ThemeColors }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reminderOn, setReminderOn] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    isNotificationsEnabled().then((v) => {
      if (live) setEnabled(v);
    });
    isStreakReminderEnabled().then((v) => {
      if (live) setReminderOn(v);
    });
    return () => {
      live = false;
    };
  }, []);

  const onToggle = async (value: boolean) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const res = await setNotificationsEnabled(value);
    setBusy(false);
    if (res.ok) {
      setEnabled(value);
      // The streak reminder is a local notification riding on the same
      // permission; re-evaluate it whenever the master switch moves.
      void syncStreakReminder();
    } else if (res.reason === "permission_denied") {
      setEnabled(false);
      setNote(
        "Notifications are blocked in your device settings — turn them on there, then try again.",
      );
    } else if (res.reason === "not_device") {
      setEnabled(false);
      setNote("Push notifications need a physical device.");
    } else {
      setNote("Couldn't change that — check your connection and try again.");
    }
  };

  const onReminderToggle = async (value: boolean) => {
    setReminderOn(value);
    await setStreakReminderEnabled(value);
  };

  return (
    <>
      <SectionHeader label="Notifications" theme={theme} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Row
          icon="notifications-outline"
          label={busy ? "Updating…" : "Notifications"}
          theme={theme}
          right={
            <Switch
              value={enabled ?? false}
              disabled={enabled === null || busy}
              onValueChange={onToggle}
              trackColor={{ false: theme.border, true: theme.accentDim }}
              thumbColor={enabled ? theme.accent : theme.textDim}
            />
          }
        />
        <Row
          icon="flame-outline"
          label="Streak reminder"
          value="8 PM nudge if today's Feed isn't finished"
          theme={theme}
          last
          right={
            <Switch
              value={reminderOn ?? false}
              disabled={enabled !== true || reminderOn === null}
              onValueChange={onReminderToggle}
              trackColor={{ false: theme.border, true: theme.accentDim }}
              thumbColor={reminderOn ? theme.accent : theme.textDim}
            />
          }
        />
      </View>
      {note ? (
        <Text style={[feedbackStyles.status, { color: theme.textDim }]}>{note}</Text>
      ) : null}
    </>
  );
}

// ── Your feed (on-device personalization) ────────────────────────────────────
// The quiz picks live only on this phone (lib/personalization.ts). This
// section shows the current state and reopens the quiz in edit mode.
// Native only, like Notifications — the parent renders it only when
// Platform.OS !== "web".
function YourFeedSection({ theme }: { theme: ThemeColors }) {
  const { prefs } = usePersonalization();
  const active = isPersonalizationActive(prefs);

  const summary = (() => {
    if (!prefs) return "Not set up yet — answer 3 quick questions.";
    if (prefs.skipped) return "Off — your feed shows everything in story order.";
    const parts: string[] = [];
    if (prefs.follows.length > 0)
      parts.push(
        `never-miss: ${prefs.follows.slice(0, 2).join(", ")}${prefs.follows.length > 2 ? "…" : ""}`,
      );
    const interestLabels = CATEGORIES.filter((c) =>
      prefs.interests.includes(c.key),
    ).map((c) => c.label);
    if (interestLabels.length > 0) parts.push(interestLabels.join(", "));
    if (prefs.vibe.length === 2) parts.push("informed + entertained");
    else if (prefs.vibe.length === 1)
      parts.push(prefs.vibe[0] === "informed" ? "staying informed" : "being entertained");
    return parts.length > 0 ? `Leading with ${parts.join(" · ")}.` : "On — no picks yet.";
  })();

  const handleTurnOff = async () => {
    if (!prefs) return;
    await savePersonalization({
      ...prefs,
      skipped: true,
      updatedAt: new Date().toISOString(),
    });
    // No Feed, no streak: make sure no reminder stays scheduled.
    void syncStreakReminder();
  };

  return (
    <>
      <SectionHeader label="Your feed" theme={theme} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Row
          icon="sparkles-outline"
          label="Personalized feed"
          value={active ? "On" : "Off"}
          theme={theme}
        />
        <Row
          icon="options-outline"
          label={prefs ? "Edit preferences" : "Set up personalization"}
          onPress={() => router.push("/personalize?edit=1" as any)}
          theme={theme}
          last={!active}
        />
        {active ? (
          <Row
            icon="close-circle-outline"
            label="Turn off"
            onPress={handleTurnOff}
            theme={theme}
            last
          />
        ) : null}
      </View>
      <Text style={[feedbackStyles.status, { color: theme.textDim }]}>{summary}</Text>
    </>
  );
}

// ── Your streak (on-device, Feed-only) ───────────────────────────────────────
// A day counts when the user finishes that day's personalized Feed
// (lib/streaks). Native only, like the other personal sections — the
// parent renders it only when Platform.OS !== "web". Users without
// personalization have no Feed to finish, so for them the card is an
// invitation to set one up.
const LOGO_MARK = require("@/assets/images/logo.png") as number;

function formatListened(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StreakSection({ theme }: { theme: ThemeColors }) {
  const { prefs } = usePersonalization();
  const active = isPersonalizationActive(prefs);
  const { state: streakState } = useStreaks();
  const { data } = useListStories(undefined, {
    query: { staleTime: 60_000 } as any,
  });
  const { playStory } = useAudio();

  const today = todayStr();
  const streak = currentStreak(streakState);
  const complete = isDayComplete(streakState, today);
  const stats = monthStats(streakState);

  const todaysFeed = useMemo(() => {
    if (!active || !prefs || !data?.stories) return [] as Story[];
    const sorted = [...(data.stories as Story[])].sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });
    return personalizedFeed(sorted, prefs);
  }, [active, prefs, data]);

  const finishedIds = new Set(finishedOn(streakState, today));
  const remaining = todaysFeed.filter((s) => !finishedIds.has(s.id));

  useEffect(() => {
    recordFeedCompletion(todaysFeed.map((s) => s.id));
  }, [todaysFeed]);

  if (!active) {
    return (
      <>
        <SectionHeader label="Your streak" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row
            icon="flame-outline"
            label="Start a streak"
            value="Set up your personalized Feed, finish it each day, and watch the streak grow."
            theme={theme}
          />
          <Row
            icon="sparkles-outline"
            label="Set up my Feed"
            onPress={() => router.push("/personalize?edit=1" as any)}
            theme={theme}
            last
          />
        </View>
      </>
    );
  }

  // Monday-first week containing today.
  const monday = addDays(today, -((new Date().getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return {
      date,
      letter: "MTWTFSS"[i],
      done: isDayComplete(streakState, date),
      isToday: date === today,
      future: date > today,
    };
  });

  return (
    <>
      <SectionHeader label="Your streak" theme={theme} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={streakStyles.topRow}>
          <View style={[streakStyles.logoWrap, { backgroundColor: theme.surfaceHigh }]}>
            <Image source={LOGO_MARK} style={streakStyles.logo} resizeMode="contain" />
          </View>
          <View style={streakStyles.topMid}>
            <Text>
              <Text style={[streakStyles.streakNum, { color: theme.text }]}>{streak}</Text>
              <Text style={[streakStyles.streakUnit, { color: theme.textMuted }]}> day streak</Text>
            </Text>
            <Text style={[streakStyles.sub, { color: theme.textMuted }]}>
              {complete
                ? "Today's Feed is done — streak safe."
                : streak === 0
                  ? "Finish today's Feed to start your streak."
                  : remaining.length > 0
                    ? `Finish today's Feed to keep it going — ${remaining.length} ${remaining.length === 1 ? "story" : "stories"} left.`
                    : "Finish today's Feed to keep it going."}
            </Text>
          </View>
          <View style={streakStyles.bestCol}>
            <Text style={[streakStyles.bestLabel, { color: theme.textDim }]}>BEST</Text>
            <Text style={[streakStyles.bestNum, { color: theme.text }]}>{streakState?.best ?? 0}</Text>
          </View>
        </View>

        <View style={streakStyles.weekRow}>
          {week.map((d) => (
            <View key={d.date} style={streakStyles.dayCol}>
              <View
                style={[
                  streakStyles.dot,
                  d.done
                    ? { backgroundColor: theme.accent, borderColor: theme.accent }
                    : d.isToday
                      ? { borderColor: theme.accent }
                      : { borderColor: theme.border, borderStyle: d.future ? ("dashed" as const) : ("solid" as const) },
                ]}
              >
                {d.done ? (
                  <Ionicons name="checkmark" size={16} color={theme.onAccent} />
                ) : d.isToday ? (
                  <View style={[streakStyles.todayDot, { backgroundColor: theme.accent }]} />
                ) : null}
              </View>
              <Text style={[streakStyles.dayLetter, { color: theme.textDim }]}>{d.letter}</Text>
            </View>
          ))}
        </View>

        <View style={[streakStyles.divider, { backgroundColor: theme.border }]} />
        {complete ? (
          <View style={streakStyles.endsRow}>
            <Ionicons name="checkmark-circle-outline" size={20} color={theme.accent} />
            <Text style={[streakStyles.endsText, { color: theme.text }]}>
              Today's Feed finished. Nice work.
            </Text>
          </View>
        ) : (
          <View style={streakStyles.endsRow}>
            <Ionicons name="notifications-outline" size={20} color={theme.accent} />
            <View style={streakStyles.endsMid}>
              <Text style={[streakStyles.endsBold, { color: theme.text }]}>
                Ends tonight at midnight.
              </Text>
              <Text style={[streakStyles.endsText, { color: theme.textMuted }]}>
                Your morning brief takes about 4 minutes.
              </Text>
            </View>
            {remaining.length > 0 ? (
              <Pressable
                onPress={() => void playStory(remaining[0])}
                style={[streakStyles.playBtn, { backgroundColor: theme.accent }]}
              >
                <Text style={[streakStyles.playText, { color: theme.onAccent }]}>Play</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={[streakStyles.divider, { backgroundColor: theme.border }]} />
        <View style={streakStyles.statsRow}>
          <View style={streakStyles.statCol}>
            <Text style={[streakStyles.statNum, { color: theme.text }]}>{stats.storiesThisMonth}</Text>
            <Text style={[streakStyles.statLabel, { color: theme.textMuted }]}>
              Stories this{"\n"}month
            </Text>
          </View>
          <View style={[streakStyles.statDivider, { backgroundColor: theme.border }]} />
          <View style={streakStyles.statCol}>
            <Text style={[streakStyles.statNum, { color: theme.accent }]}>
              {formatListened(streakState?.listenedSec ?? 0)}
            </Text>
            <Text style={[streakStyles.statLabel, { color: theme.textMuted }]}>Listened</Text>
          </View>
          <View style={[streakStyles.statDivider, { backgroundColor: theme.border }]} />
          <View style={streakStyles.statCol}>
            <Text style={[streakStyles.statNum, { color: theme.text }]}>{stats.daysActiveThisMonth}</Text>
            <Text style={[streakStyles.statLabel, { color: theme.textMuted }]}>Days active</Text>
          </View>
        </View>
      </View>
    </>
  );
}

const streakStyles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    gap: 14,
  },
  logoWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: 40, height: 40 },
  topMid: { flex: 1 },
  streakNum: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 32,
  },
  streakUnit: {
    fontFamily: "Inter_500Medium",
    fontSize: 17,
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13.5,
    lineHeight: 18,
    marginTop: 4,
  },
  bestCol: { alignItems: "flex-end" },
  bestLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 1,
  },
  bestNum: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 22,
    marginTop: 2,
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  dayCol: { alignItems: "center", gap: 6 },
  dot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  todayDot: { width: 8, height: 8, borderRadius: 4 },
  dayLetter: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  divider: { height: 1, marginHorizontal: 16, opacity: 0.6 },
  endsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
  },
  endsMid: { flex: 1 },
  endsBold: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  endsText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  playBtn: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
  },
  playText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  statsRow: { flexDirection: "row", paddingVertical: 14 },
  statCol: { flex: 1, alignItems: "center", gap: 2 },
  statDivider: { width: 1 },
  statNum: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 19,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
});

// ── Beta feedback ─────────────────────────────────────────────────────────────
// Suggestion box for beta testers. Posts to POST /api/feedback, which stores
// the message for the morning digest batch and the admin portal Feedback
// page — nothing is emailed on submit. There is no account to attach, so
// the box is shown to guests and signed-in users alike. The API base mirrors
// app/_layout.tsx: EXPO_PUBLIC_DOMAIN, else EXPO_PUBLIC_API_BASE, else the
// web origin.
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

const FEEDBACK_KEYBOARD_BAR_ID = "crrnt-feedback-keyboard";

function BetaFeedback({ theme }: { theme: ThemeColors }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether the box is focused so the non-iOS Done button can
  // close the keyboard: a multiline input has no return-to-dismiss.
  // (iOS gets the KeyboardDismissBar pinned above the keyboard.)
  const [focused, setFocused] = useState(false);

  const handleSend = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          platform: Platform.OS,
          app_version: Constants.expoConfig?.version ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setText("");
      setSent(true);
      // Sending ends the typing session, so close the keyboard too.
      Keyboard.dismiss();
    } catch {
      setError("Couldn't send that — check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <SectionHeader label="Beta feedback" theme={theme} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, padding: 16 }]}>
        <Text style={[feedbackStyles.intro, { color: theme.textDim }]}>
          Testing CRRNT? Tell us what works, what's broken, or what you'd like
          to see — it goes straight to the team.
        </Text>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            setSent(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Share a suggestion or report a bug…"
          placeholderTextColor={theme.textDim}
          multiline
          numberOfLines={4}
          maxLength={2000}
          inputAccessoryViewID={
            Platform.OS === "ios" ? FEEDBACK_KEYBOARD_BAR_ID : undefined
          }
          style={[
            feedbackStyles.input,
            {
              backgroundColor: theme.surfaceHigh,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />
        <KeyboardDismissBar nativeID={FEEDBACK_KEYBOARD_BAR_ID} theme={theme} />
        {/* In-card Done is the non-iOS fallback; iOS gets the ✕ bar
            pinned above the keyboard instead. */}
        {focused && Platform.OS !== "ios" ? (
          <Pressable
            onPress={() => Keyboard.dismiss()}
            hitSlop={8}
            style={feedbackStyles.doneBtn}
          >
            <Text style={[feedbackStyles.doneBtnText, { color: theme.accent }]}>
              Done
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleSend}
          disabled={!text.trim() || sending}
          style={[
            feedbackStyles.sendBtn,
            {
              backgroundColor: theme.accent,
              opacity: !text.trim() || sending ? 0.5 : 1,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <Text style={[feedbackStyles.sendBtnText, { color: theme.onAccent }]}>
              {sent ? "Sent — thanks!" : "Send feedback"}
            </Text>
          )}
        </Pressable>
        {sent ? (
          <Text style={[feedbackStyles.status, { color: theme.accent }]}>
            Thanks — your feedback was sent.
          </Text>
        ) : null}
        {error ? (
          <Text style={[feedbackStyles.status, { color: "#F87171" }]}>{error}</Text>
        ) : null}
      </View>
    </>
  );
}

const feedbackStyles = StyleSheet.create({
  intro: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  input: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 21,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 96,
    textAlignVertical: "top",
  },
  sendBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  doneBtn: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  doneBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  sendBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#fff",
  },
  status: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 10,
  },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const bottomPad = useChromeBottomPadding();
  // Desktop: a left-aligned column rather than a full-width list.
  const isDesktop = useIsDesktop();
  const desktopFrame = isDesktop ? styles.desktopFrame : null;
  const desktopColumn = isDesktop ? styles.desktopColumn : null;
  const { isDark, theme, toggleTheme } = useThemeContext();
  const { user, logout, forgotPassword, accessToken, isGuest, sendVerificationEmail, deleteAccount } = useAuth();
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dialog, setDialog] = useState<{
    title: string;
    message?: string;
    buttons: AlertButton[];
  } | null>(null);

  const { data: quizData } = useGetOnboardingQuiz();

  const handleSendVerification = async () => {
    setSendingVerification(true);
    await sendVerificationEmail();
    setSendingVerification(false);
    setVerificationSent(true);
  };

  if ((isGuest || !user) && AUTH_ENABLED) {
    return <Redirect href={"/login" as any} />;
  }

  // Accounts are off: guests get the device-only settings. Interests need an
  // account (the preferences API is per-user), so they return with login.
  if (isGuest || !user) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: insets.top }, desktopFrame]}>
        <Text style={[styles.screenTitle, { color: theme.text }, desktopColumn]}>
          {Platform.OS === "web" ? "Settings" : "You"}
        </Text>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, desktopColumn]}
            showsVerticalScrollIndicator={false}
          >
          <View style={[styles.accountCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={[styles.avatar, { backgroundColor: theme.surfaceHigh }]}>
              <Ionicons name="person-outline" size={22} color={theme.accent} />
            </View>
            <View style={styles.accountInfo}>
              <Text style={[styles.accountEmail, { color: theme.text }]}>Browsing as a guest</Text>
              <Text style={[styles.guestNote, { color: theme.textDim }]}>
                Saved stories are kept on this device.
              </Text>
            </View>
          </View>

          {Platform.OS !== "web" && <StreakSection theme={theme} />}

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

          {Platform.OS !== "web" && <NotificationsSection theme={theme} />}

          {Platform.OS !== "web" && <YourFeedSection theme={theme} />}

          <BetaFeedback theme={theme} />

          <SectionHeader label="Legal" theme={theme} />
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Row
              icon="document-text-outline"
              label="Privacy Policy"
              onPress={() => router.push("/privacy" as any)}
              theme={theme}
              last
            />
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  const closeDialog = () => setDialog(null);

  const prefs = quizData?.preferences;

  const interestsSummary = prefs?.interests?.length
    ? prefs.interests.join(", ")
    : "Not set";

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
        await deleteAccount();
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
        message: "Your saved stories and preferences will be removed immediately.",
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
    <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: insets.top }, desktopFrame]}>
      <AlertDialog
        visible={dialog !== null}
        title={dialog?.title ?? ""}
        message={dialog?.message}
        buttons={dialog?.buttons ?? []}
      />
      <Text style={[styles.screenTitle, { color: theme.text }, desktopColumn]}>Settings</Text>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, desktopColumn]}
          showsVerticalScrollIndicator={false}
        >
        {/* ── Email verification banner ──────────────────────────────── */}
        {user.email_verified === false && (
          <View style={bannerStyles.banner}>
            <Ionicons name="mail-unread-outline" size={20} color="#92400E" style={{ marginTop: 1 }} />
            <View style={bannerStyles.body}>
              <Text style={bannerStyles.title}>Verify your email</Text>
              <Text style={bannerStyles.subtitle}>
                {verificationSent
                  ? "Email sent — check your inbox and click the link."
                  : "Check your inbox for a verification link."}
              </Text>
            </View>
            {!verificationSent && (
              <Pressable
                onPress={handleSendVerification}
                disabled={sendingVerification}
                style={bannerStyles.btn}
              >
                {sendingVerification ? (
                  <ActivityIndicator size="small" color="#92400E" />
                ) : (
                  <Text style={bannerStyles.btnText}>Resend</Text>
                )}
              </Pressable>
            )}
          </View>
        )}

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
          </View>
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

        {Platform.OS !== "web" && <NotificationsSection theme={theme} />}

        <BetaFeedback theme={theme} />

        {/* ── Legal ──────────────────────────────────────────────── */}
        <SectionHeader label="Legal" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row
            icon="document-text-outline"
            label="Privacy Policy"
            onPress={() => router.push("/privacy" as any)}
            theme={theme}
            last
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
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Desktop: the screen fills the window; only the content column is capped.
  desktopFrame: { paddingHorizontal: 20, paddingTop: 24 },
  desktopColumn: { width: "100%", maxWidth: 720 },
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
  guestNote: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
});

const bannerStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FCD34D",
    padding: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  body: { flex: 1 },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#92400E",
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#92400E",
    marginTop: 2,
    lineHeight: 18,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D97706",
    minWidth: 60,
    alignItems: "center",
  },
  btnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#92400E",
  },
});
