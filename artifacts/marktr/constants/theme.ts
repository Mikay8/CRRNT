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
  bg:            "#0A0E1A",
  bgElevated:    "#111726",
  surface:       "#161D2E",
  surfaceHigh:   "#1F2840",
  border:        "#222B45",
  borderStrong:  "#2D3854",
  text:          "#F5F7FA",
  textMuted:     "#9AA3B5",
  textDim:       "#6A7388",
  accent:        "#00D67E",
  accentDim:     "#00B86A",
  positive:      "#00E89E",
  negative:      "#FF4D6D",
  warning:       "#FFB347",
  overlay:       "rgba(8,11,20,0.70)",
  divider:       "#1B2236",
  celebrity:     "#FF5BA8",
  tech:          "#5EC2FF",
  government:    "#FFB347",
  sports:        "#A06BFF",
  business:      "#F97316",
  science:       "#2DD4BF",
  entertainment: "#EF4444",
};

export const lightTheme: ThemeColors = {
  bg:            "#F8F9FB",
  bgElevated:    "#FFFFFF",
  surface:       "#F0F2F7",
  surfaceHigh:   "#E8EBF2",
  border:        "#D5D9E8",
  borderStrong:  "#BEC5D9",
  text:          "#0A0E1A",
  textMuted:     "#4A5268",
  textDim:       "#7A849A",
  accent:        "#00B86A",
  accentDim:     "#009A58",
  positive:      "#00A878",
  negative:      "#E8334A",
  warning:       "#D98A1A",
  overlay:       "rgba(240,242,247,0.85)",
  divider:       "#E2E6F0",
  celebrity:     "#E8407A",
  tech:          "#2A9FE0",
  government:    "#D98A1A",
  sports:        "#7C4FD4",
  business:      "#D4600A",
  science:       "#1CAFA0",
  entertainment: "#CC2020",
};

export type ColorScheme = "dark" | "light";
