/**
 * Preferences edit screen — lets users update their topic interests,
 * financial goals, city, and other personalization data post-onboarding.
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
import { Ionicons } from "@expo/vector-icons";
import {
  useGetOnboardingQuiz,
  useSaveOnboardingQuiz,
} from "@workspace/api-client-react";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";

// ── Option data (mirrors onboarding.tsx) ────────────────────────────────────

const INTERESTS = [
  "Celebrity", "Tech", "Government", "Sports",
  "Business", "Science", "Entertainment",
];

const GOALS = [
  "Save more money", "Pay off debt", "Invest in stocks", "Buy a home",
  "Start a business", "Build an emergency fund", "Travel more", "Retire early",
];

const JOB_TYPES = [
  "Tech / Engineering", "Finance / Banking", "Healthcare", "Education",
  "Retail / Hospitality", "Creative / Media", "Government", "Self-employed",
  "Student", "Other",
];

const LIFE_STAGES = [
  "In college", "Just starting out", "Building my career",
  "Starting a family", "Mid-career", "Pre-retirement",
];

const INCOME = [
  "Under $30k", "$30k–$60k", "$60k–$100k",
  "$100k–$150k", "$150k+", "Prefer not to say",
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ label, theme }: { label: string; theme: ThemeColors }) {
  return (
    <Text style={[sStyles.sectionLabel, { color: theme.textMuted }]}>{label}</Text>
  );
}

function ChipGrid({
  options,
  selected,
  multi,
  onToggle,
  theme,
}: {
  options: string[];
  selected: string | string[];
  multi: boolean;
  onToggle: (val: string) => void;
  theme: ThemeColors;
}) {
  const isSelected = (opt: string) =>
    multi
      ? (selected as string[]).includes(opt)
      : selected === opt;

  return (
    <View style={sStyles.chipGrid}>
      {options.map((opt) => {
        const active = isSelected(opt);
        return (
          <Pressable
            key={opt}
            onPress={() => onToggle(opt)}
            style={[
              sStyles.chip,
              { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent + "1A" : theme.surface },
            ]}
          >
            <Text style={[sStyles.chipText, { color: active ? theme.accent : theme.textMuted }]}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

interface Prefs {
  interests: string[];
  financial_goals: string[];
  job_type: string;
  life_stage: string;
  income_bracket: string;
  city: string;
}

const DEFAULTS: Prefs = {
  interests: [],
  financial_goals: [],
  job_type: "",
  life_stage: "",
  income_bracket: "",
  city: "",
};

export default function PreferencesScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useThemeContext();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useGetOnboardingQuiz();
  const saveQuiz = useSaveOnboardingQuiz();

  // Pre-fill with existing preferences once loaded
  useEffect(() => {
    const p = data?.preferences;
    if (!p) return;
    setPrefs({
      interests: p.interests ?? [],
      financial_goals: p.financial_goals ?? [],
      job_type: p.job_type ?? "",
      life_stage: p.life_stage ?? "",
      income_bracket: p.income_bracket ?? "",
      city: p.city ?? "",
    });
  }, [data]);

  function toggleMulti(key: keyof Prefs, val: string) {
    setPrefs((prev) => {
      const arr = (prev[key] as string[]) || [];
      return {
        ...prev,
        [key]: arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val],
      };
    });
  }

  function toggleSingle(key: keyof Prefs, val: string) {
    setPrefs((prev) => ({ ...prev, [key]: prev[key] === val ? "" : val }));
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveQuiz.mutateAsync({
        data: {
          interests: prefs.interests.length ? prefs.interests : undefined,
          financial_goals: prefs.financial_goals.length ? prefs.financial_goals : undefined,
          job_type: prefs.job_type || undefined,
          life_stage: prefs.life_stage || undefined,
          income_bracket: prefs.income_bracket || undefined,
          city: prefs.city || undefined,
        },
      } as Parameters<typeof saveQuiz.mutateAsync>[0]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent — user can retry
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[sStyles.loader, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={[sStyles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[sStyles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={sStyles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={theme.accent} />
          <Text style={[sStyles.backText, { color: theme.accent }]}>Settings</Text>
        </Pressable>
        <Text style={[sStyles.headerTitle, { color: theme.text }]}>Preferences</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView
        contentContainerStyle={[sStyles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Interests */}
        <SectionLabel label="Topics you care about" theme={theme} />
        <ChipGrid
          options={INTERESTS}
          selected={prefs.interests}
          multi
          onToggle={(v) => toggleMulti("interests", v)}
          theme={theme}
        />

        {/* Financial goals */}
        <SectionLabel label="Money goals" theme={theme} />
        <ChipGrid
          options={GOALS}
          selected={prefs.financial_goals}
          multi
          onToggle={(v) => toggleMulti("financial_goals", v)}
          theme={theme}
        />

        {/* Job type */}
        <SectionLabel label="What do you do for work?" theme={theme} />
        <ChipGrid
          options={JOB_TYPES}
          selected={prefs.job_type}
          multi={false}
          onToggle={(v) => toggleSingle("job_type", v)}
          theme={theme}
        />

        {/* Life stage */}
        <SectionLabel label="Where are you in life?" theme={theme} />
        <ChipGrid
          options={LIFE_STAGES}
          selected={prefs.life_stage}
          multi={false}
          onToggle={(v) => toggleSingle("life_stage", v)}
          theme={theme}
        />

        {/* City */}
        <SectionLabel label="City (optional)" theme={theme} />
        <TextInput
          style={[
            sStyles.textInput,
            { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text },
          ]}
          value={prefs.city}
          onChangeText={(v) => setPrefs((p) => ({ ...p, city: v }))}
          placeholder="e.g. New York, Miami, Chicago…"
          placeholderTextColor={theme.textDim}
          autoCapitalize="words"
        />

        {/* Income */}
        <SectionLabel label="Rough income range (optional)" theme={theme} />
        <ChipGrid
          options={INCOME}
          selected={prefs.income_bracket}
          multi={false}
          onToggle={(v) => toggleSingle("income_bracket", v)}
          theme={theme}
        />
      </ScrollView>

      {/* Save button */}
      <View style={[sStyles.footer, { paddingBottom: insets.bottom + 16, borderTopColor: theme.border, backgroundColor: theme.bg }]}>
        <Pressable
          style={({ pressed }) => [
            sStyles.saveBtn,
            { backgroundColor: saved ? theme.positive : theme.accent },
            pressed && { opacity: 0.8 },
          ]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={sStyles.saveBtnText}>
              {saved ? "Saved ✓" : "Save preferences"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const sStyles = StyleSheet.create({
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, width: 70 },
  backText: { fontFamily: "Inter_500Medium", fontSize: 15 },
  headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 18 },
  content: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 20,
  },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#fff",
  },
});
