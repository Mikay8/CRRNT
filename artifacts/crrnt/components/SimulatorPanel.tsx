import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import {
  useSimulateInvestment,
  type SimulateResponse,
} from "@workspace/api-client-react";
import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";

interface SimulatorPanelProps {
  ticker: string;
  defaultStartDate?: string;
}

const AMOUNT_OPTIONS = [100, 500, 1000, 5000];
const TIMEFRAMES = [
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 1825 },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function Chip({ label, active, onPress }: ChipProps) {
  const { theme: palette } = useThemeContext();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        chipStyles.chip,
        {
          backgroundColor: active ? palette.accent + "26" : palette.surfaceHigh,
          borderColor: active ? palette.accent : palette.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          chipStyles.chipLabel,
          { color: active ? palette.accent : palette.textMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
});

export function SimulatorPanel({ ticker }: SimulatorPanelProps) {
  const { theme: palette } = useThemeContext();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [amount, setAmount] = useState(1000);
  const [days, setDays] = useState(365);
  const [result, setResult] = useState<SimulateResponse | null>(null);

  const mutation = useSimulateInvestment({
    mutation: {
      onSuccess: (data) => setResult(data),
    },
  });

  const run = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    mutation.mutate({
      data: {
        ticker,
        amount,
        startDate: isoDaysAgo(days),
      },
    });
  };

  const positive = (result?.profitLoss ?? 0) >= 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Ionicons name="flash" size={18} color={palette.accent} />
        <Text style={styles.title}>What if you'd invested?</Text>
      </View>

      <Text style={styles.label}>Amount</Text>
      <View style={styles.row}>
        {AMOUNT_OPTIONS.map((opt) => (
          <Chip
            key={opt}
            label={fmtMoney(opt)}
            active={amount === opt}
            onPress={() => {
              Haptics.selectionAsync().catch(() => undefined);
              setAmount(opt);
            }}
          />
        ))}
      </View>

      <Text style={styles.label}>Time ago</Text>
      <View style={styles.row}>
        {TIMEFRAMES.map((tf) => (
          <Chip
            key={tf.label}
            label={tf.label}
            active={days === tf.days}
            onPress={() => {
              Haptics.selectionAsync().catch(() => undefined);
              setDays(tf.days);
            }}
          />
        ))}
      </View>

      <Pressable
        onPress={run}
        disabled={mutation.isPending}
        style={({ pressed }) => [
          styles.cta,
          {
            backgroundColor: palette.accent,
            opacity: mutation.isPending ? 0.7 : pressed ? 0.85 : 1,
          },
        ]}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#001A11" />
        ) : (
          <Text style={styles.ctaLabel}>Run simulation</Text>
        )}
      </Pressable>

      {mutation.isError ? (
        <Text style={styles.error}>
          Couldn't simulate this one. The ticker may not have enough history.
        </Text>
      ) : null}

      {result ? (
        <View style={styles.result}>
          <Text style={styles.resultLabel}>You would have</Text>
          <Text style={styles.resultValue}>{fmtMoney(result.currentValue)}</Text>
          <View style={styles.deltaRow}>
            <Ionicons
              name={positive ? "trending-up" : "trending-down"}
              size={16}
              color={positive ? palette.positive : palette.negative}
            />
            <Text
              style={[
                styles.delta,
                { color: positive ? palette.positive : palette.negative },
              ]}
            >
              {positive ? "+" : ""}
              {fmtMoney(result.profitLoss)} ({result.percentChange.toFixed(2)}%)
            </Text>
          </View>
          <Text style={styles.meta}>
            {result.sharesPurchased.toFixed(4)} shares @ ${result.startPrice.toFixed(2)}
            {"\n"}since {result.startDate}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: palette.surface,
      borderRadius: 18,
      padding: 16,
      gap: 10,
      borderWidth: 1,
      borderColor: palette.border,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 4,
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 16,
      color: palette.text,
    },
    label: {
      fontFamily: "Inter_500Medium",
      fontSize: 12,
      color: palette.textDim,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      marginTop: 6,
    },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    cta: {
      marginTop: 12,
      height: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    ctaLabel: {
      fontFamily: "Inter_700Bold",
      fontSize: 15,
      color: "#001A11",
    },
    error: {
      color: palette.negative,
      fontFamily: "Inter_500Medium",
      fontSize: 13,
      marginTop: 6,
    },
    result: {
      marginTop: 12,
      padding: 14,
      borderRadius: 14,
      backgroundColor: palette.bgElevated,
      borderWidth: 1,
      borderColor: palette.border,
      gap: 4,
    },
    resultLabel: {
      fontFamily: "Inter_500Medium",
      fontSize: 12,
      color: palette.textDim,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    resultValue: {
      fontFamily: "Inter_700Bold",
      fontSize: 32,
      color: palette.text,
      letterSpacing: -0.5,
    },
    deltaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 4,
    },
    delta: {
      fontFamily: "Inter_700Bold",
      fontSize: 15,
    },
    meta: {
      marginTop: 8,
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: palette.textDim,
      lineHeight: 18,
    },
  });
}

export default SimulatorPanel;
