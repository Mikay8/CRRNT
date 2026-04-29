import { useColorScheme } from "react-native";

import { darkTheme, lightTheme, type ThemeColors } from "@/constants/theme";

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === "light" ? lightTheme : darkTheme;
}
