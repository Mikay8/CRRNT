import { useThemeContext } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/constants/theme";

export function useTheme(): ThemeColors {
  return useThemeContext().theme;
}
