import { Platform, useWindowDimensions } from "react-native";

/** Web windows at least this wide get the desktop layout; narrower ones fall back to mobile. */
export const DESKTOP_MIN_WIDTH = 900;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= DESKTOP_MIN_WIDTH;
}

/** Desktop chrome geometry, shared by the nav, player, toast and queue panel. */
export const DESKTOP = {
  margin: 20,
  navTabW: 96,
  navW: 96 * 3 + 10,
  barH: 64,
  barMaxW: 420,
  queueW: 380,
};

/**
 * Where the desktop player bar sits: bottom-right, beside the nav — or above
 * the nav when the window (minus an open queue panel) is too tight for both.
 */
export function desktopBarFrame(w: number, queueInset: number) {
  "worklet";
  const { margin, navW, barH, barMaxW } = DESKTOP;
  const avail = w - queueInset - margin * 2 - navW - 16;
  const stack = avail < 240;
  const width = stack ? Math.min(barMaxW, w - queueInset - margin * 2) : Math.min(barMaxW, avail);
  return {
    left: w - queueInset - margin - width,
    bottom: stack ? margin + barH + 10 : margin,
    width,
  };
}
