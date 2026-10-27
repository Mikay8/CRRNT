/**
 * NavChromeContext — shared state for the floating tab bar and the player.
 *
 * `collapse` (0 → 1) tucks the tab bar into a single button while the feed
 * scrolls down; the mini player slides in beside it. `expand` (0 → 1) morphs
 * the mini player into the full-screen player. Both are UI-thread shared
 * values so the tab bar, player and toast can animate off the same spring.
 * `queue` (0 → 1) tracks the queue sheet / desktop side panel.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { withSpring, useSharedValue, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsDesktop } from "@/hooks/useLayoutMode";

export const NAV = {
  inset: 14,
  tabH: 64,
  gap: 8,
  miniH: 60,
};

const COLLAPSE_SPRING = { stiffness: 320, damping: 32, mass: 1 };
export const EXPAND_SPRING = { stiffness: 240, damping: 31, mass: 1 };
export const QUEUE_SPRING = { stiffness: 260, damping: 32 };

interface NavChromeValue {
  collapse: SharedValue<number>;
  expand: SharedValue<number>;
  queue: SharedValue<number>;
  isCollapsed: boolean;
  setCollapsed: (v: boolean) => void;
  onFeedScroll: (y: number) => void;
  isPlayerOpen: boolean;
  openPlayer: () => void;
  closePlayer: () => void;
  /** Called by the player when a drag settles, so JS state follows the gesture. */
  syncPlayerOpen: (open: boolean) => void;
  isQueueOpen: boolean;
  setQueueOpen: (v: boolean) => void;
}

const NavChromeContext = createContext<NavChromeValue | null>(null);

interface NavChromeActions {
  setQueueOpen: (v: boolean) => void;
  openPlayer: () => void;
}

// Stable actions only, for components (like every story card) that must not
// re-render each time the nav tucks away mid-scroll.
const NavChromeActionsContext = createContext<NavChromeActions | null>(null);

export function NavChromeProvider({ children }: { children: React.ReactNode }) {
  const collapse = useSharedValue(0);
  const expand = useSharedValue(0);
  const queue = useSharedValue(0);
  const isDesktop = useIsDesktop();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const lastY = useRef(0);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isQueueOpen, setQueueOpen] = useState(false);

  const setCollapsed = useCallback(
    (v: boolean) => {
      if (collapsedRef.current === v) return;
      collapsedRef.current = v;
      setIsCollapsed(v);
      collapse.value = withSpring(v ? 1 : 0, COLLAPSE_SPRING);
    },
    [collapse],
  );

  useEffect(() => {
    queue.value = withSpring(isQueueOpen ? 1 : 0, QUEUE_SPRING);
  }, [isQueueOpen, queue]);

  // The desktop layout never tucks the nav away, and the player morphs
  // between different shapes in each layout, so reset both on a switch.
  useEffect(() => {
    setCollapsed(false);
    setIsPlayerOpen(false);
    expand.value = 0;
  }, [isDesktop, setCollapsed, expand]);

  // Tuck on a deliberate downward scroll past the header; restore on any
  // upward scroll or near the top.
  const onFeedScroll = useCallback(
    (y: number) => {
      if (y > lastY.current + 6 && y > 60) setCollapsed(true);
      else if (y < lastY.current - 6 || y < 20) setCollapsed(false);
      lastY.current = y;
    },
    [setCollapsed],
  );

  const openPlayer = useCallback(() => {
    setIsPlayerOpen(true);
    expand.value = withSpring(1, { ...EXPAND_SPRING, velocity: 2 });
  }, [expand]);

  const closePlayer = useCallback(() => {
    setIsPlayerOpen(false);
    expand.value = withSpring(0, EXPAND_SPRING);
  }, [expand]);

  const value = useMemo(
    () => ({
      collapse,
      expand,
      queue,
      isCollapsed,
      setCollapsed,
      onFeedScroll,
      isPlayerOpen,
      openPlayer,
      closePlayer,
      syncPlayerOpen: setIsPlayerOpen,
      isQueueOpen,
      setQueueOpen,
    }),
    [collapse, expand, queue, isCollapsed, setCollapsed, onFeedScroll, isPlayerOpen, openPlayer, closePlayer, isQueueOpen],
  );

  const actions = useMemo(() => ({ setQueueOpen, openPlayer }), [openPlayer]);

  return (
    <NavChromeContext.Provider value={value}>
      <NavChromeActionsContext.Provider value={actions}>{children}</NavChromeActionsContext.Provider>
    </NavChromeContext.Provider>
  );
}

export function useNavChrome(): NavChromeValue {
  const ctx = useContext(NavChromeContext);
  if (!ctx) throw new Error("useNavChrome must be used inside NavChromeProvider");
  return ctx;
}

export function useNavChromeActions(): NavChromeActions {
  const ctx = useContext(NavChromeActionsContext);
  if (!ctx) throw new Error("useNavChromeActions must be used inside NavChromeProvider");
  return ctx;
}

/** Distance from the screen bottom to the floating tab bar. */
export function useTabBarBottom(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom - 8, 14);
}

/** Bottom padding that keeps list content clear of the tab bar and mini player. */
export function useChromeBottomPadding(): number {
  return useTabBarBottom() + NAV.tabH + NAV.gap + NAV.miniH + 24;
}
