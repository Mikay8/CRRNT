import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";

import { darkTheme, lightTheme, type ThemeColors } from "@/constants/theme";

const STORAGE_KEY = "@crrnt/color-mode/v1";

interface ThemeContextValue {
  isDark: boolean;
  theme: ThemeColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: true,
  theme: darkTheme,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [userMode, setUserMode] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        if (val === "dark" || val === "light") setUserMode(val);
      })
      .catch(() => {});
  }, []);

  const isDark =
    userMode !== null ? userMode === "dark" : systemScheme !== "light";

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    setUserMode(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  return (
    <ThemeContext.Provider
      value={{ isDark, theme: isDark ? darkTheme : lightTheme, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useThemeContext = () => useContext(ThemeContext);
