/**
 * ToastContext — short glass confirmations ("Saved", "Added to queue")
 * that float just above the tab bar / mini player.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export interface Toast {
  key: number;
  text: string;
  color: string;
  action?: { label: string; onPress: () => void };
}

interface ToastValue {
  toast: Toast | null;
  showToast: (t: Omit<Toast, "key">) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const TOAST_MS = 1800;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((t: Omit<Toast, "key">) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...t, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), t.action ? TOAST_MS + 1200 : TOAST_MS);
  }, []);

  const value = useMemo(() => ({ toast, showToast, hideToast }), [toast, showToast, hideToast]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
