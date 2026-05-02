"use client";

/**
 * ApiKeyRevealModal
 *
 * One-time key reveal modal shown immediately after a new API key is created.
 *
 * Security constraints:
 *  - Outside-click dismiss is blocked (`onInteractOutside` prevented)
 *  - Escape key dismiss is blocked (`onEscapeKeyDown` prevented)
 *  - The only way to close the modal is the "I've saved my key" button
 *
 * The raw key is held only in the parent's component state. Calling `onDismiss`
 * signals the parent to clear that state and navigate away.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@revnixhq/ui";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { AlertTriangle, Check, Copy } from "@admin/components/icons";
import { UI } from "@admin/constants/ui";

// ============================================================
// Props
// ============================================================

export interface ApiKeyRevealModalProps {
  open: boolean;
  /** The raw key string — shown once, then discarded. May be null while closed. */
  rawKey: string | null;
  /** Called when the user confirms they have saved the key. */
  onDismiss: () => void;
}

// ============================================================
// Component
// ============================================================

export const ApiKeyRevealModal: React.FC<ApiKeyRevealModalProps> = ({
  open,
  rawKey,
  onDismiss,
}) => {
  const [copied, setCopied] = useState(false);

  // Reset copied state whenever the modal opens with a new key
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  const handleCopy = useCallback(() => {
    if (!rawKey) return;
    void navigator.clipboard.writeText(rawKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    });
  }, [rawKey]);

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg"
        aria-describedby="reveal-key-description"
        // Block all passive dismiss paths — user must explicitly confirm
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Save your API key</DialogTitle>
          <DialogDescription id="reveal-key-description" asChild>
            <div>
              {/* Warning banner */}
              <div className="mt-1 flex items-start gap-2.5 rounded-none border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  This key will not be shown again. Copy and store it somewhere
                  safe now — once you dismiss this dialog, it cannot be
                  recovered.
                </span>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Key display */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Your API key</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-none border bg-primary/5 px-3 py-2 font-mono text-sm break-all">
              {rawKey ?? ""}
            </code>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={handleCopy}
              aria-label={copied ? "Copied" : "Copy key"}
              className="shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={onDismiss}
            className="w-full sm:w-auto"
          >
            I&apos;ve saved my key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
