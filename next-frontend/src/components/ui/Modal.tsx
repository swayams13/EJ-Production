"use client";

import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

const SIZE_CLASS: Record<string, string> = {
  sm: "max-w-sm",
  lg: "max-w-2xl",
  xl: "max-w-5xl",
};

export default function Modal({
  open,
  onClose,
  title,
  description,
  size = "sm",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: "sm" | "lg" | "xl";
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`w-full ${SIZE_CLASS[size]} rounded-lg border border-line bg-paper-raised shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 pb-0">
          <h4 id="modal-title" className="text-base font-bold text-ink mb-1">
            {title}
          </h4>
          {description && <p className="text-sm text-ink-soft">{description}</p>}
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
