"use client";

import { useCallback, useRef, useState } from "react";
import Modal from "./Modal";
import Button from "./Button";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "primary" | "danger";
}

/**
 * Replaces window.confirm() with an accessible modal. Usage:
 *   const { confirm, dialog } = useConfirm();
 *   if (await confirm({ title: "Remove operator?", tone: "danger" })) { ... }
 *   return <>{dialog}...</>
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | undefined>(undefined);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const handle = (result: boolean) => {
    setOptions(null);
    resolver.current?.(result);
  };

  const dialog = options ? (
    <Modal open title={options.title} description={options.description} onClose={() => handle(false)}>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={() => handle(false)}>
          Cancel
        </Button>
        <Button variant={options.tone === "danger" ? "danger" : "primary"} onClick={() => handle(true)}>
          {options.confirmLabel || "Confirm"}
        </Button>
      </div>
    </Modal>
  ) : null;

  return { confirm, dialog };
}
