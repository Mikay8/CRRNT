/**
 * Personalize-your-feed quiz — first run (via PersonalizationGate in
 * app/_layout.tsx) and again from Settings → Your feed (edit mode,
 * ?edit=1). Visual design is Mikayla's (2026-10-30 mockups): glowing
 * intro with the CRRNT logo, progress segments + Skip header, big
 * category pills with checkmarks, an Informed—Both—Entertained slider,
 * and a free-text never-miss list ("add a name, team, topic or place").
 *
 * Answers are saved ONLY to this phone (lib/personalization.ts) — no
 * account, nothing uploaded — and the feed ranks stories against them
 * locally. Skipping is a real state: the feed keeps its normal order
 * and Settings can reopen the quiz anytime.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";
import { CATEGORIES, CATEGORY_ICONS, type Category } from "@/constants/categories";
import {
  loadPersonalization,
  savePersonalization,
  suggestionsFor,
  type VibeTag,
} from "@/lib/personalization";
import { syncStreakReminder } from "@/lib/streak-reminder";

type Step = "intro" | "categories" | "vibe" | "must" | "done";
const STEP_PROGRESS: Record<Step, number> = {
  intro: 0,
  categories: 1,
  vibe: 2,
  must: 3,
  done: 4,
};

const VIBE_STOPS: { tags: VibeTag[]; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { tags: ["informed"], label: "Stay informed", icon: "newspaper" },
  { tags: ["informed", "entertained"], label: "A bit of both", icon: "infinite" },
  { tags: ["entertained"], label: "Be entertained", icon: "sparkles" },
];

const LOGO = require("@/assets/images/logo.png") as number;

/** Soft radial glow behind the top of the screen, as in the mockups. */
function TopGlow({ color }: { color: string }) {
  return (
    <View style={pStyles.glow} pointerEvents="none">
      <Svg width={560} height={380} viewBox="0 0 560 380">
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="0%" r="75%">
            <Stop offset="0" stopColor={color} stopOpacity={0.32} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={560} height={380} fill="url(#glow)" />
      </Svg>
    </View>
  );
}

/** Informed — Both — Entertained snap slider (design: gradient fill,
 * white thumb, tap or drag to a stop). */
function VibeSlider({
  index,
  onChange,
  theme,
  primary,
}: {
  index: number;
  onChange: (i: number) => void;
  theme: ThemeColors;
  primary: string;
}) {
  const [trackW, setTrackW] = useState(0);
  const thumbX = useSharedValue(0);
  const THUMB = 52;

  useEffect(() => {
    if (trackW > 0) {
      thumbX.value = withSpring((index * (trackW - THUMB)) / 2, {
        damping: 20,
        stiffness: 220,
      });
    }
  }, [index, trackW, thumbX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const pickFromX = (x: number) => {
    if (trackW <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / trackW));
    onChange(Math.round(ratio * 2));
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => runOnJS(pickFromX)(e.x))
    .onEnd((e) => runOnJS(pickFromX)(e.x));

  const stopCenter = (i: number) => (i * (trackW - THUMB)) / 2 + THUMB / 2;

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          style={[pStyles.sliderTrack, { backgroundColor: theme.surface }]}
          onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        >
          {trackW > 0 ? (
            <Svg width={trackW} height={62} style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="trackGrad" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#38BDF8" />
                  <Stop offset="1" stopColor="#2DD4BF" />
                </LinearGradient>
              </Defs>
              <Rect
                x={0}
                y={0}
                width={stopCenter(index)}
                height={62}
                rx={31}
                fill="url(#trackGrad)"
                opacity={0.85}
              />
            </Svg>
          ) : null}
          {trackW > 0 &&
            [0, 1, 2].map((i) => (
              <View
                key={i}
                style={[
                  pStyles.sliderDot,
                  { left: stopCenter(i) - 3, backgroundColor: "#FFFFFF59" },
                ]}
              />
            ))}
          <View style={pStyles.sliderTaps}>
            {[0, 1, 2].map((i) => (
              <Pressable key={i} style={{ flex: 1 }} onPress={() => onChange(i)} />
            ))}
          </View>
          <Animated.View
            pointerEvents="none"
            style={[pStyles.sliderThumb, thumbStyle]}
          >
            <Ionicons name="swap-horizontal" size={22} color="#0B1520" />
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={pStyles.sliderLabels}>
        {["Informed", "Both", "Entertained"].map((label, i) => (
          <Text
            key={label}
            style={[
              pStyles.sliderLabel,
              i === 1 && { textAlign: "center" },
              i === 2 && { textAlign: "right" },
              {
                color: index === i ? theme.text : theme.textMuted,
                fontFamily: index === i ? "Inter_600SemiBold" : "Inter_500Medium",
              },
            ]}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function PersonalizeScreen() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useThemeContext();
  const params = useLocalSearchParams<{ edit?: string }>();
  const editMode = params.edit === "1";

  const primary = isDark ? "#4FB8E8" : theme.accentDim;
  const onPrimary = isDark ? "#07222E" : "#FFFFFF";

  const [step, setStep] = useState<Step>(editMode ? "categories" : "intro");
  const [interests, setInterests] = useState<Category[]>([]);
  const [vibeIndex, setVibeIndex] = useState(1);
  const [follows, setFollows] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  // Edit mode pre-fills from the stored picks. A plain visit when the
  // quiz was already answered (and not via Settings) bounces to the
  // feed — the gate only routes here when nothing is stored.
  useEffect(() => {
    let cancelled = false;
    loadPersonalization().then((prefs) => {
      if (cancelled) return;
      if (prefs && editMode) {
        setInterests(prefs.interests);
        setFollows(prefs.follows);
        const idx = VIBE_STOPS.findIndex(
          (s) => [...s.tags].sort().join() === [...prefs.vibe].sort().join(),
        );
        if (idx >= 0) setVibeIndex(idx);
      } else if (prefs && !editMode) {
        router.replace("/(tabs)" as any);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editMode]);

  const suggestions = useMemo(
    () =>
      suggestionsFor(interests).filter(
        (s) => !follows.some((f) => f.toLowerCase() === s.toLowerCase()),
      ),
    [interests, follows],
  );

  const finishToFeed = () => {
    if (editMode) router.back();
    else router.replace("/(tabs)" as any);
  };

  const saveAnd = async (
    prefs: { skipped: boolean; interests: Category[]; vibe: VibeTag[]; follows: string[] },
    next: () => void,
  ) => {
    await savePersonalization({
      version: 1,
      updatedAt: new Date().toISOString(),
      ...prefs,
    });
    // Streaks (and their reminder) follow personalization state.
    void syncStreakReminder();
    next();
  };

  /** Skip finishes the quiz: selections made so far are kept; with no
   * interests and no follows there is nothing to personalize with, so
   * it records the plain skipped state. */
  const handleSkip = async () => {
    if (!editMode && (interests.length > 0 || follows.length > 0)) {
      await saveAnd(
        { skipped: false, interests, vibe: VIBE_STOPS[vibeIndex].tags, follows },
        finishToFeed,
      );
    } else if (!editMode) {
      await saveAnd(
        { skipped: true, interests: [], vibe: [], follows: [] },
        finishToFeed,
      );
    }
  };

  const handleSave = async () => {
    await saveAnd(
      { skipped: false, interests, vibe: VIBE_STOPS[vibeIndex].tags, follows },
      () => setStep("done"),
    );
  };

  const toggleInterest = (key: Category) => {
    setInterests((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const addFollow = (raw: string) => {
    const term = raw.trim().replace(/\s+/g, " ");
    if (term.length < 2) return;
    if (follows.some((f) => f.toLowerCase() === term.toLowerCase())) {
      setDraft("");
      return;
    }
    setFollows((prev) => [...prev, term]);
    setDraft("");
  };

  const goBack = () => {
    if (step === "categories") {
      if (editMode) router.back();
      else setStep("intro");
    } else if (step === "vibe") setStep("categories");
    else if (step === "must") setStep("vibe");
  };

  const doneSummary = useMemo(() => {
    const parts: string[] = [];
    if (follows.length > 0) {
      const list =
        follows.length === 1
          ? follows[0]
          : follows.length === 2
            ? `${follows[0]} and ${follows[1]}`
            : `${follows[0]}, ${follows[1]} and ${follows.length - 2} more`;
      parts.push(`${list} will always lead your feed.`);
    }
    const labels = CATEGORIES.filter((c) => interests.includes(c.key)).map(
      (c) => c.label,
    );
    if (labels.length > 0) {
      parts.push(`Plus more ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? "…" : ""}.`);
    }
    return parts.length > 0
      ? parts.join(" ")
      : "Your feed is tuned to your picks.";
  }, [follows, interests]);

  const primaryButton = (
    label: string,
    onPress: (() => void) | null,
    enabled = true,
  ) => (
    <Pressable
      onPress={enabled ? (onPress ?? undefined) : undefined}
      style={[
        pStyles.primary,
        { backgroundColor: enabled ? primary : theme.surface },
      ]}
    >
      <Text
        style={[
          pStyles.primaryText,
          { color: enabled ? onPrimary : theme.textMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[pStyles.container, { backgroundColor: theme.bg }]}>
      <TopGlow color={theme.accentDim} />
      <View style={{ paddingTop: insets.top + 8, flex: 1 }}>
        {step !== "intro" && (
          <View style={pStyles.header}>
            <Pressable
              onPress={goBack}
              style={[pStyles.backBtn, { backgroundColor: theme.surface }]}
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={20} color={theme.text} />
            </Pressable>
            <View style={pStyles.segments}>
              {[1, 2, 3, 4].map((n) => (
                <View
                  key={n}
                  style={[
                    pStyles.segment,
                    {
                      backgroundColor:
                        n <= STEP_PROGRESS[step] ? primary : theme.surface,
                    },
                  ]}
                />
              ))}
            </View>
            {editMode ? (
              <View style={{ width: 34 }} />
            ) : (
              <Pressable onPress={handleSkip} accessibilityLabel="Skip">
                <Text style={[pStyles.skipText, { color: theme.textMuted }]}>Skip</Text>
              </Pressable>
            )}
          </View>
        )}

        <ScrollView
          contentContainerStyle={pStyles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === "intro" && (
            <View style={pStyles.introWrap}>
              <Image
                source={LOGO}
                style={pStyles.logo}
                resizeMode="contain"
                accessibilityLabel="CRRNT"
              />
              <Text style={[pStyles.introTitle, { color: theme.text }]}>
                Make CRRNT{"\n"}yours
              </Text>
              <Text style={[pStyles.subtitle, { color: theme.textMuted }]}>
                Three quick questions and your feed leads with the stories
                that match you. Everything stays on your phone.
              </Text>
            </View>
          )}

          {step === "categories" && (
            <>
              <Text style={[pStyles.title, { color: theme.text }]}>
                What do you want more of?
              </Text>
              <Text style={[pStyles.subtitle, { color: theme.textMuted }]}>
                Pick as many as you like.
              </Text>
              <View style={pStyles.chipWrap}>
                {CATEGORIES.map((cat) => {
                  const active = interests.includes(cat.key);
                  return (
                    <Pressable
                      key={cat.key}
                      onPress={() => toggleInterest(cat.key)}
                      style={({ pressed }) => [
                        pStyles.chip,
                        {
                          backgroundColor: active ? cat.color + "33" : theme.surface,
                          borderColor: active ? cat.color : theme.border,
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={CATEGORY_ICONS[cat.icon]}
                        size={20}
                        color={active ? cat.color : theme.textMuted}
                      />
                      <Text
                        style={[
                          pStyles.chipText,
                          { color: active ? cat.color : theme.text },
                        ]}
                      >
                        {cat.label}
                      </Text>
                      {active ? (
                        <Ionicons name="checkmark" size={18} color={cat.color} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {step === "vibe" && (
            <>
              <Text style={[pStyles.title, { color: theme.text }]}>
                When you open CRRNT, you want to…
              </Text>
              <Text style={[pStyles.subtitle, { color: theme.textMuted }]}>
                Slide to where you land.
              </Text>
              <View
                style={[
                  pStyles.vibeCard,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <View style={[pStyles.vibeTile, { backgroundColor: primary + "26" }]}>
                  <Ionicons
                    name={VIBE_STOPS[vibeIndex].icon}
                    size={28}
                    color={primary}
                  />
                </View>
                <Text style={[pStyles.vibeLabel, { color: theme.text }]}>
                  {VIBE_STOPS[vibeIndex].label}
                </Text>
              </View>
              <VibeSlider
                index={vibeIndex}
                onChange={setVibeIndex}
                theme={theme}
                primary={primary}
              />
            </>
          )}

          {step === "must" && (
            <>
              <Text style={[pStyles.title, { color: theme.text }]}>
                And the one we should never bury?
              </Text>
              <Text style={[pStyles.subtitle, { color: theme.textMuted }]}>
                Add a name, team, topic or place. These always lead your
                feed.
              </Text>
              <View
                style={[
                  pStyles.inputRow,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <Ionicons name="star-outline" size={20} color={theme.textMuted} />
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={() => addFollow(draft)}
                  placeholder="e.g. Taylor Swift, the Fed, Lakers"
                  placeholderTextColor={theme.textDim}
                  style={[pStyles.input, { color: theme.text }]}
                  returnKeyType="done"
                  autoCorrect={false}
                />
                <Pressable
                  onPress={() => addFollow(draft)}
                  style={[
                    pStyles.addBtn,
                    {
                      backgroundColor: theme.surfaceHigh,
                      opacity: draft.trim().length >= 2 ? 1 : 0.4,
                    },
                  ]}
                  accessibilityLabel="Add"
                >
                  <Ionicons name="add" size={20} color={theme.text} />
                </Pressable>
              </View>

              {follows.length > 0 && (
                <View style={pStyles.chipWrap}>
                  {follows.map((term) => (
                    <View
                      key={term}
                      style={[
                        pStyles.termChip,
                        { backgroundColor: theme.surface, borderColor: theme.border },
                      ]}
                    >
                      <Text style={[pStyles.termText, { color: theme.text }]}>{term}</Text>
                      <Pressable
                        onPress={() =>
                          setFollows((prev) => prev.filter((f) => f !== term))
                        }
                        hitSlop={8}
                        accessibilityLabel={`Remove ${term}`}
                      >
                        <Ionicons name="close" size={15} color={theme.textMuted} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {suggestions.length > 0 && (
                <>
                  <Text style={[pStyles.sectionLabel, { color: theme.textDim }]}>
                    Based on your picks
                  </Text>
                  <View style={pStyles.chipWrap}>
                    {suggestions.map((term) => (
                      <Pressable
                        key={term}
                        onPress={() => addFollow(term)}
                        style={[
                          pStyles.termChip,
                          { backgroundColor: theme.surface, borderColor: theme.border },
                        ]}
                      >
                        <Ionicons name="add" size={15} color={primary} />
                        <Text style={[pStyles.termText, { color: theme.text }]}>
                          {term}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          {step === "done" && (
            <>
              <Text style={[pStyles.title, { color: theme.text }]}>You're set</Text>
              <Text style={[pStyles.subtitle, { color: theme.textMuted }]}>
                {doneSummary} Change it anytime in Settings → Your feed.
              </Text>
            </>
          )}
        </ScrollView>

        <View style={[pStyles.footer, { paddingBottom: insets.bottom + 14 }]}>
          {step === "intro" && (
            <>
              {primaryButton("Let's do it", () => setStep("categories"))}
              <Pressable onPress={handleSkip} style={pStyles.skipBtn}>
                <Text style={[pStyles.skipBtnText, { color: theme.textMuted }]}>
                  Skip — show me everything
                </Text>
              </Pressable>
            </>
          )}
          {step === "categories" &&
            primaryButton(
              interests.length > 0 ? `Continue · ${interests.length}` : "Continue",
              () => setStep("vibe"),
            )}
          {step === "vibe" && primaryButton("Continue", () => setStep("must"))}
          {step === "must" &&
            (editMode
              ? primaryButton("Save my picks", handleSave)
              : primaryButton(
                  follows.length > 0 ? "Done" : "Add at least one",
                  handleSave,
                  follows.length > 0,
                ))}
          {step === "done" &&
            primaryButton(editMode ? "Back to Settings" : "Start reading", finishToFeed)}
        </View>
      </View>
    </View>
  );
}

const pStyles = StyleSheet.create({
  container: { flex: 1 },
  glow: {
    position: "absolute",
    top: -190,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  segments: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    marginHorizontal: 16,
  },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  skipText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  introWrap: { marginTop: 90 },
  // logo.png is a square canvas with the wave mark inset (~9% left,
  // ~17% top); the negative margins align the ink with the title.
  logo: { width: 120, height: 120, marginLeft: -11, marginTop: -14 },
  introTitle: {
    fontFamily: "Outfit_800ExtraBold",
    fontSize: 42,
    lineHeight: 46,
    marginTop: 30,
    marginBottom: 16,
  },
  title: {
    fontFamily: "Outfit_800ExtraBold",
    fontSize: 32,
    lineHeight: 38,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 26,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 19,
  },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  vibeCard: {
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 30,
    alignItems: "center",
    gap: 14,
    marginBottom: 26,
  },
  vibeTile: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  vibeLabel: { fontFamily: "Outfit_700Bold", fontSize: 23 },
  sliderTrack: {
    height: 62,
    borderRadius: 999,
    justifyContent: "center",
    overflow: "hidden",
  },
  sliderDot: {
    position: "absolute",
    top: 28,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sliderTaps: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
  },
  sliderThumb: {
    position: "absolute",
    left: 5,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  sliderLabels: { flexDirection: "row", marginTop: 12 },
  sliderLabel: { flex: 1, fontSize: 14 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingLeft: 16,
    paddingRight: 8,
    height: 58,
    marginBottom: 18,
  },
  input: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 16, height: "100%" },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  termChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  termText: { fontFamily: "Inter_500Medium", fontSize: 14.5 },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 26,
    marginBottom: 12,
  },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  primary: {
    height: 58,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontFamily: "Inter_700Bold", fontSize: 17 },
  skipBtn: { paddingVertical: 16, alignItems: "center" },
  skipBtnText: { fontFamily: "Inter_500Medium", fontSize: 15 },
});
