/**
 * Marktr color palette — a finance-meets-pop-culture mobile app.
 *
 * Inspired by Robinhood / Coinbase (deep navy + electric green) with the
 * editorial color accents we use to differentiate categories.
 */

const palette = {
  bg: "#0A0E1A",
  bgElevated: "#111726",
  surface: "#161D2E",
  surfaceHigh: "#1F2840",
  border: "#222B45",
  borderStrong: "#2D3854",
  text: "#F5F7FA",
  textMuted: "#9AA3B5",
  textDim: "#6A7388",
  accent: "#00D67E", // electric green
  accentDim: "#00B86A",
  positive: "#00E89E",
  negative: "#FF4D6D",
  warning: "#FFB347",
  overlay: "rgba(8,11,20,0.70)",
  divider: "#1B2236",
  // Category accents
  celebrity: "#FF5BA8", // hot pink
  tech: "#5EC2FF", // electric blue
  government: "#FFB347", // amber
  sports: "#A06BFF", // royal violet
  business: "#F97316", // orange
  science: "#2DD4BF", // teal
} as const;

export type ColorPalette = typeof palette;

export const COLORS = palette;

// useColors() expects an object — keep this aligned to the palette.
export default palette;
