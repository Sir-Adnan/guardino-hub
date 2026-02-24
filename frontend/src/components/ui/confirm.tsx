"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function ConfirmModal({
  open,
  onClose,
  title,
  body,
  confirmText,
  cancelText,
  danger,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {body ? <div className="text-sm text-[hsl(var(--fg))]/75 leading-6">{body}</div> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {cancelText}
          </Button>
          <Button
            type="button"
            onClick={async () => {
              await onConfirm();
            }}
            disabled={busy}
            className={cn(danger ? "bg-red-600 text-white hover:opacity-90" : "")}
          >
            {busy ? "…" : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
