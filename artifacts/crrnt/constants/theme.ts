/**
 * CRRNT theme config — dark and light color schemes.
 *
 * All keys are identical across both themes so any component
 * can swap schemes without structural changes.
 *
 * Usage: import { useTheme } from "@/hooks/useTheme"
 */

export interface ThemeColors {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceHigh: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentDim: string;
  positive: string;
  negative: string;
  warning: string;
  overlay: string;
  divider: string;
  celebrity: string;
  tech: string;
  government: string;
  sports: string;
  business: string;
  science: string;
  entertainment: string;
}

export const darkTheme: ThemeColors = {
  bg: "#090D12",
  bgElevated: "#101820",
  surface: "#152030",
  surfaceHigh: "#1A2840",
  border: "#1E3048",
  borderStrong: "#243A52",
  text: "#E8F4FF",
  textMuted: "#7098B4",
  textDim: "#405E78",
  accent: "#06B6D4",
  accentDim: "#0891B2",
  positive: "#10B981",
  negative: "#F87171",
  warning: "#F59E0B",
  overlay: "rgba(4,8,18,0.75)",
  divider: "#162030",
  celebrity: "#F472B6",
  tech: "#38BDF8",
  government: "#FB923C",
  sports: "#A78BFA",
  business: "#F97316",
  science: "#2DD4BF",
  entertainment: "#C084FC",
};

export const lightTheme: ThemeColors = {
  bg: "#EEF8FF",
  bgElevated: "#FFFFFF",
  surface: "#F0F7FF",
  surfaceHigh: "#E4EFF8",
  border: "#B8DDEF",
  borderStrong: "#8BBDD8",
  text: "#061828",
  textMuted: "#3A6080",
  textDim: "#6A8CA8",
  accent: "#0891B2",
  accentDim: "#0E7490",
  positive: "#059669",
  negative: "#DC2626",
  warning: "#D97706",
  overlay: "rgba(238,248,255,0.85)",
  divider: "#CCE8F4",
  celebrity: "#E8407A",
  tech: "#0284C7",
  government: "#D97706",
  sports: "#7C3AED",
  business: "#D4600A",
  science: "#0D9488",
  entertainment: "#9333EA",
};
export type ColorScheme = "dark" | "light";
