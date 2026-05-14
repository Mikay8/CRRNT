/**
 * Onboarding flow — runs once after registration.
 *
 * Phase 1 (privacy):  Data & privacy disclosure — required for all new users.
 * Phase 2 (paywall):  RevenueCat paywall presented as a native modal.
 *                     Purchased → quiz.  Dismissed → mark complete, go to feed.
 * Phase 3 (quiz):     Personalization quiz — paid users only.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { usePurchases } from "@/contexts/PurchasesContext";
import { useSaveOnboardingQuiz } from "@workspace/api-client-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "privacy" | "paywall" | "quiz";

// ── Quiz data ─────────────────────────────────────────────────────────────────

const JOB_TYPES = [
  "Tech / Engineering", "Finance / Banking", "Healthcare", "Education",
  "Retail / Hospitality", "Creative / Media", "Government", "Self-employed",
  "Student", "Other",
];
const LIFE_STAGES = [
  "In college", "Just starting out", "Building my career", "Starting a family",
  "Mid-career", "Pre-retirement",
];
const INTERESTS = [
  "Celebrity", "Tech", "Government", "Sports", "Business", "Science", "Entertainment",
];
const GOALS = [
  "Save more money", "Pay off debt", "Invest in stocks", "Buy a home",
  "Start a business", "Build an emergency fund", "Travel more", "Retire early",
];
const INCOME = [
  "Under $30k", "$30k–$60k", "$60k–$100k", "$100k–$150k", "$150k+", "Prefer not to say",
];

interface QuizStep {
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

const QUIZ_STEPS: QuizStep[] = [
  { title: "What do you do for work?", subtitle: "Helps us connect stories to your career.", key: "job_type", type: "single", options: JOB_TYPES },
  { title: "Where are you in life?", subtitle: "Helps us understand what matters most right now.", key: "life_stage", type: "single", options: LIFE_STAGES },
  { title: "What topics do you care about?", subtitle: "Select all that apply — we'll prioritize these in your feed.", key: "interests", type: "multi", options: INTERESTS },
  { title: "What are your money goals?", subtitle: "We'll connect financial stories to what you're working toward.", key: "financial_goals", type: "multi", options: GOALS },
  { title: "What city are you in?", subtitle: "So we can flag news that hits close to home. (Optional)", key: "city", type: "text" },
  { title: "Rough income range?", subtitle: "Helps us gauge how news affects your wallet. (Optional)", key: "income_bracket", type: "single", options: INCOME },
];

// ── Privacy screen ─────────────────────────────────────────────────────────────

function PrivacyScreen({ onContinue }: { onContinue: () => void }) {
  const insets = useSafeAreaInsets();
  const { deleteAccount } = useAuth();
  const [declining, setDeclining] = useState(false);

  const handleDecline = () => {
    Alert.alert(
      "Decline & delete account",
      "This will permanently delete your account and all associated data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete my data",
          style: "destructive",
          onPress: async () => {
            setDeclining(true);
            await deleteAccount();
            // AuthGate will redirect to /login once user is null
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.privacyContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.privacyHeading}>Your data & privacy</Text>
        <Text style={styles.privacyIntro}>
          Before you continue, here's a plain-English summary of how we handle your information.
        </Text>

        <Text style={styles.privacySection}>What we collect</Text>
        <Text style={styles.privacyBody}>
          • Your email address and account credentials{"\n"}
          • Answers from the optional personalization quiz{"\n"}
          • Stories you save and topics you engage with{"\n"}
          • Basic device info (platform, push notification token)
        </Text>

        <Text style={styles.privacySection}>How we use it</Text>
        <Text style={styles.privacyBody}>
          Your data is used solely to personalize your news feed and improve CRRNT. We do not sell your personal information to third parties or use it for advertising.
        </Text>

        <Text style={styles.privacySection}>Third-party services</Text>
        <Text style={styles.privacyBody}>
          • <Text style={styles.privacyBold}>Supabase</Text> — secure cloud database where your account and preferences are stored{"\n"}
          • <Text style={styles.privacyBold}>RevenueCat</Text> — handles subscription payments through Apple / Google; CRRNT never sees your card details{"\n"}
          • <Text style={styles.privacyBold}>Expo / Apple / Google</Text> — push notifications (optional; you can decline)
        </Text>

        <Text style={styles.privacySection}>Your rights</Text>
        <Text style={styles.privacyBody}>
          You can delete your account and all associated data at any time from <Text style={styles.privacyBold}>Settings → Delete account</Text>. Deletion is permanent and immediate.
        </Text>

        <Text style={styles.privacyFootnote}>
          By continuing you acknowledge that you have read and understood this privacy summary.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={({ pressed }) => [styles.nextBtn, pressed && styles.nextBtnPressed]}
          onPress={onContinue}
          disabled={declining}
        >
          <Text style={styles.nextBtnText}>I understand, continue</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.declineBtn, pressed && styles.nextBtnPressed]}
          onPress={handleDecline}
          disabled={declining}
        >
          {declining ? (
            <ActivityIndicator color="#EF4444" size="small" />
          ) : (
            <Text style={styles.declineBtnText}>Decline & delete my data</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ── Paywall gate ──────────────────────────────────────────────────────────────

function PaywallGate({
  onPurchased,
  onSkipped,
}: {
  onPurchased: () => void;
  onSkipped: () => void;
}) {
  const { presentPaywall } = usePurchases();
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    presentPaywall().then((purchased) => {
      if (purchased) {
        onPurchased();
      } else {
        onSkipped();
      }
    });
  }, []);

  return (
    <View style={styles.paywallWait}>
      <ActivityIndicator color="#06B6D4" size="large" />
    </View>
  );
}

// ── Quiz screen ───────────────────────────────────────────────────────────────

function QuizScreen({ onComplete }: { onComplete: () => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ ...QUIZ_DEFAULTS });
  const [submitting, setSubmitting] = useState(false);
  const saveQuiz = useSaveOnboardingQuiz();

  const current = QUIZ_STEPS[step];
  const total = QUIZ_STEPS.length;
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
    if (current.type === "single" && step === QUIZ_STEPS.length - 1) return true;
    const val = answers[current.key];
    if (Array.isArray(val)) return val.length > 0;
    return Boolean(val);
  };

  const handleNext = async () => {
    if (step < total - 1) {
      setStep((s) => s + 1);
      return;
    }
    setSubmitting(true);
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
      // best-effort — still proceed
    }
    await onComplete();
    setSubmitting(false);
  };

  const handleSkip = async () => {
    if (step < total - 1) {
      setStep((s) => s + 1);
      return;
    }
    setSubmitting(true);
    await onComplete();
    setSubmitting(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom }]}>
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
        contentContainerStyle={styles.quizContent}
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

// ── Root orchestrator ─────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { user, updateUser } = useAuth();
  const [phase, setPhase] = useState<Phase>("privacy");

  useEffect(() => {
    if (user?.onboarding_complete) {
      router.replace("/(tabs)");
    }
  }, [user?.onboarding_complete]);

  const finish = async () => {
    await updateUser({ onboarding_complete: true });
    router.replace("/(tabs)");
  };

  if (phase === "privacy") {
    return <PrivacyScreen onContinue={() => setPhase("paywall")} />;
  }

  if (phase === "paywall") {
    return (
      <PaywallGate
        onPurchased={() => setPhase("quiz")}
        onSkipped={finish}
      />
    );
  }

  return <QuizScreen onComplete={finish} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#090D12" },
  scroll: { flex: 1 },

  // ── Privacy ──────────────────────────────────────────────────────────────────
  privacyContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  privacyHeading: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: "#F9FAFB",
    marginBottom: 10,
  },
  privacyIntro: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: "#9CA3AF",
    lineHeight: 22,
    marginBottom: 28,
  },
  privacySection: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#06B6D4",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 4,
  },
  privacyBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#D1D5DB",
    lineHeight: 22,
    marginBottom: 24,
  },
  privacyBold: {
    fontFamily: "Inter_600SemiBold",
    color: "#F9FAFB",
  },
  privacyFootnote: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#4B5563",
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 8,
  },

  // ── Paywall waiting ───────────────────────────────────────────────────────────
  paywallWait: {
    flex: 1,
    backgroundColor: "#090D12",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Quiz ──────────────────────────────────────────────────────────────────────
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
  quizContent: {
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

  // ── Shared footer ─────────────────────────────────────────────────────────────
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
  declineBtn: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  declineBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#EF4444",
  },
});
