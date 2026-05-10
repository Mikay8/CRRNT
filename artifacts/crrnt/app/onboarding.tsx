/**
 * Onboarding quiz — collected once after registration.
 * Answers feed the personalization engine.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { useSaveOnboardingQuiz } from "@workspace/api-client-react";

// ── Data ─────────────────────────────────────────────────────────────────────

const JOB_TYPES = [
  "Tech / Engineering",
  "Finance / Banking",
  "Healthcare",
  "Education",
  "Retail / Hospitality",
  "Creative / Media",
  "Government",
  "Self-employed",
  "Student",
  "Other",
];

const LIFE_STAGES = [
  "In college",
  "Just starting out",
  "Building my career",
  "Starting a family",
  "Mid-career",
  "Pre-retirement",
];

const INTERESTS = [
  "Celebrity",
  "Tech",
  "Government",
  "Sports",
  "Business",
  "Science",
  "Entertainment",
];

const GOALS = [
  "Save more money",
  "Pay off debt",
  "Invest in stocks",
  "Buy a home",
  "Start a business",
  "Build an emergency fund",
  "Travel more",
  "Retire early",
];

const INCOME = [
  "Under $30k",
  "$30k–$60k",
  "$60k–$100k",
  "$100k–$150k",
  "$150k+",
  "Prefer not to say",
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Step {
  title: string;
  subtitle: string;
  key: keyof typeof QUIZ_DEFAULTS;
  type: "single" | "multi" | "text";
  options?: string[];
}

const QUIZ_DEFAULTS = {
  job_type: "" as string,
  life_stage: "" as string,
  interests: [] as string[],
  financial_goals: [] as string[],
  income_bracket: "" as string,
  city: "" as string,
};

const STEPS: Step[] = [
  {
    title: "What do you do for work?",
    subtitle: "Helps us connect stories to your career.",
    key: "job_type",
    type: "single",
    options: JOB_TYPES,
  },
  {
    title: "Where are you in life?",
    subtitle: "Helps us understand what matters most right now.",
    key: "life_stage",
    type: "single",
    options: LIFE_STAGES,
  },
  {
    title: "What topics do you care about?",
    subtitle: "Select all that apply — we'll prioritize these in your feed.",
    key: "interests",
    type: "multi",
    options: INTERESTS,
  },
  {
    title: "What are your money goals?",
    subtitle: "We'll connect financial stories to what you're working toward.",
    key: "financial_goals",
    type: "multi",
    options: GOALS,
  },
  {
    title: "What city are you in?",
    subtitle: "So we can flag news that hits close to home. (Optional)",
    key: "city",
    type: "text",
  },
  {
    title: "Rough income range?",
    subtitle: "Helps us gauge how news affects your wallet. (Optional)",
    key: "income_bracket",
    type: "single",
    options: INCOME,
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ ...QUIZ_DEFAULTS });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.onboarding_complete) {
      router.replace("/(tabs)");
    }
  }, [user?.onboarding_complete]);

  const saveQuiz = useSaveOnboardingQuiz();
  const current = STEPS[step];
  const total = STEPS.length;
  const progress = (step + 1) / total;

  function toggleSingle(key: keyof typeof QUIZ_DEFAULTS, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }));
  }

  function toggleMulti(key: keyof typeof QUIZ_DEFAULTS, value: string) {
    setAnswers((prev) => {
      const arr = (prev[key] as string[]) || [];
      return {
        ...prev,
        [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
      };
    });
  }

  const canProceed = () => {
    if (current.type === "text") return true;
    if (current.type === "single" && step === STEPS.length - 1) return true;
    const val = answers[current.key];
    if (Array.isArray(val)) return val.length > 0;
    return Boolean(val);
  };

  const submitQuiz = async () => {
    try {
      await saveQuiz.mutateAsync({
        data: {
          job_type: answers.job_type || undefined,
          life_stage: answers.life_stage || undefined,
          interests: answers.interests.length ? answers.interests : undefined,
          financial_goals: answers.financial_goals.length ? answers.financial_goals : undefined,
          city: answers.city || undefined,
          income_bracket: answers.income_bracket || undefined,
        },
      } as Parameters<typeof saveQuiz.mutateAsync>[0]);
    } catch {
      // best-effort — still mark complete locally so the user isn't stuck
    }
    await updateUser({ onboarding_complete: true });
  };

  const handleNext = async () => {
    if (step < total - 1) {
      setStep((s) => s + 1);
      return;
    }
    setSubmitting(true);
    await submitQuiz();
    setSubmitting(false);
  };

  const handleSkip = async () => {
    if (step < total - 1) {
      setStep((s) => s + 1);
      return;
    }
    setSubmitting(true);
    await submitQuiz();
    setSubmitting(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom }]}>
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
      </View>

      <View style={styles.stepIndicator}>
        <Text style={styles.stepText}>{step + 1} / {total}</Text>
        <Pressable onPress={handleSkip}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.subtitle}>{current.subtitle}</Text>

        <View style={styles.options}>
          {current.type === "text" ? (
            <TextInput
              style={styles.textInput}
              value={answers.city}
              onChangeText={(v) => setAnswers((a) => ({ ...a, city: v }))}
              placeholder="e.g. New York, Miami, Chicago…"
              placeholderTextColor="#4B5563"
              autoCapitalize="words"
            />
          ) : (
            (current.options ?? []).map((opt) => {
              const isArr = Array.isArray(answers[current.key]);
              const selected = isArr
                ? (answers[current.key] as string[]).includes(opt)
                : answers[current.key] === opt;

              return (
                <Pressable
                  key={opt}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() =>
                    current.type === "multi"
                      ? toggleMulti(current.key, opt)
                      : toggleSingle(current.key, opt)
                  }
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {opt}
                  </Text>
                  {selected && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={({ pressed }) => [
            styles.nextBtn,
            !canProceed() && styles.nextBtnDisabled,
            pressed && styles.nextBtnPressed,
          ]}
          onPress={handleNext}
          disabled={!canProceed() || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.nextBtnText}>
              {step === total - 1 ? "Get started" : "Continue"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#090D12" },
  progressTrack: {
    height: 3,
    backgroundColor: "#1F2937",
    marginHorizontal: 24,
    borderRadius: 2,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#06B6D4",
    borderRadius: 2,
  },
  stepIndicator: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  stepText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#6B7280",
  },
  skipText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#06B6D4",
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 26,
    color: "#F9FAFB",
    lineHeight: 34,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 24,
    lineHeight: 20,
  },
  options: { gap: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  optionSelected: {
    backgroundColor: "#06B6D41A",
    borderColor: "#06B6D4",
  },
  optionText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: "#D1D5DB",
  },
  optionTextSelected: { color: "#06B6D4" },
  check: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#06B6D4",
  },
  textInput: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1F2937",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#F9FAFB",
    fontFamily: "Inter_400Regular",
    fontSize: 16,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
  },
  nextBtn: {
    backgroundColor: "#06B6D4",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  nextBtnDisabled: { opacity: 0.45 },
  nextBtnPressed: { opacity: 0.8 },
  nextBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#fff",
  },
});
