"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ToastTone = "success" | "critical";

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

const toneClasses: Record<ToastTone, string> = {
  success: "bg-success text-white",
  critical: "bg-critical text-white",
};

/**
 * Replaces window.alert() with a non-blocking toast. Usage:
 *   const { showToast, toasts } = useToast();
 *   showToast("Workforce productivity updated");
 *   return <>{toasts}...</>
 */
export function useToast() {
  const [items, setItems] = useState<ToastState[]>([]);

  const showToast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = Date.now();
    setItems((prev) => [...prev, { id, message, tone }]);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const timer = setTimeout(() => setItems((prev) => prev.slice(1)), 3000);
    return () => clearTimeout(timer);
  }, [items]);

  const toasts =
    typeof document !== "undefined"
      ? createPortal(
          <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
            {items.map((t) => (
              <div
                key={t.id}
                role="status"
                className={`rounded-md px-4 py-2.5 text-sm font-medium shadow-lg ${toneClasses[t.tone]}`}
              >
                {t.message}
              </div>
            ))}
          </div>,
          document.body
        )
      : null;

  return { showToast, toasts };
}
