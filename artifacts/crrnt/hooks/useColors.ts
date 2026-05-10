import { useThemeContext } from "@/contexts/ThemeContext";

/**
 * Returns a color map that bridges the generic design-system naming
 * (background, foreground, card, primary, …) to CRRNT's ThemeColors.
 *
 * Use this in legacy components that were scaffolded with shadcn-style names.
 * Prefer importing `useThemeContext` directly in new components.
 */
export function useColors() {
  const { theme } = useThemeContext();
  return {
    // Spread the full theme first so all raw keys are available
    ...theme,
    // Map generic design-system names to CRRNT ThemeColors
    background: theme.bg,
    foreground: theme.text,
    card: theme.surface,
    cardForeground: theme.text,
    primary: theme.accent,
    primaryForeground: theme.bg,
    secondary: theme.surface,
    secondaryForeground: theme.textMuted,
    muted: theme.surfaceHigh,
    mutedForeground: theme.textMuted,
    accentForeground: theme.bg,
    ring: theme.accent,
    destructive: theme.negative,
    destructiveForeground: "#fff",
  };
}

export default useColors;
