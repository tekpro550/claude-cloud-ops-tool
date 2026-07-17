import { useCallback, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

/**
 * Guards a destructive action behind a ConfirmDialog with minimal per-call
 * boilerplate. Call `confirm({ title, message, onConfirm })` from a delete
 * button's onClick, and render `confirmDialog` once in the component's JSX.
 * Replaces the fire-on-click deletes that had no prompt and no undo.
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => setOpts(options), []);

  const confirmDialog = opts ? (
    <ConfirmDialog
      title={opts.title}
      message={opts.message}
      confirmLabel={opts.confirmLabel}
      onConfirm={() => {
        opts.onConfirm();
        setOpts(null);
      }}
      onCancel={() => setOpts(null)}
    />
  ) : null;

  return { confirm, confirmDialog };
}
