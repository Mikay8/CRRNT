import { useSegments } from "expo-router";
import { useAudio } from "@/contexts/AudioContext";
import { NAV } from "@/contexts/NavChromeContext";

/** Where the mini player docks: above the tab bar, or beside it once collapsed. */
export function usePlayerDock() {
  const segments = useSegments();
  const { story, isBarVisible } = useAudio();
  const inTabs = segments[0] === "(tabs)";
  const visible = isBarVisible && !!story && segments[0] !== "story";
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
