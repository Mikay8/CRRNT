import { useSegments } from "expo-router";
import { useAudio } from "@/contexts/AudioContext";
import { NAV } from "@/contexts/NavChromeContext";
import { useIsDesktop } from "@/hooks/useLayoutMode";

/** Where the mini player docks: above the tab bar, or beside it once collapsed. */
export function usePlayerDock() {
  const segments = useSegments();
  const { story, isBarVisible } = useAudio();
  // Story screens carry their own copy of the tab bar, so dock the same way there.
  const inTabs = segments[0] === "(tabs)" || segments[0] === "story";
  // The desktop story panel carries its own audio bar instead.
  const isDesktop = useIsDesktop();
  const visible = isBarVisible && !!story && !(isDesktop && segments[0] === "story");
  return { inTabs, visible };
}

export function miniFrame(collapse: number, inTabs: boolean, tabBottom: number) {
  "worklet";
  const c = inTabs ? collapse : 0;
  return {
    left: NAV.inset + c * (NAV.tabH + NAV.gap),
    bottom: inTabs ? tabBottom + (1 - c) * (NAV.tabH + NAV.gap) : tabBottom,
    height: NAV.miniH + c * (NAV.tabH - NAV.miniH),
  };
}
