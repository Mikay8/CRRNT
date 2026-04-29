/**
 * Legacy re-export — kept so existing imports of `@/constants/colors`
 * continue to work. New code should import from `@/constants/theme`
 * and use the `useTheme()` hook for scheme-aware colors.
 */
export { darkTheme as default, darkTheme as COLORS, type ThemeColors as ColorPalette } from "./theme";
