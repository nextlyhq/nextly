"use client";

/**
 * WebhookSecretModal — shows one or more signing secrets.
 *
 * Two modes. On create (`oneTime`) the secret is shown exactly once, so every
 * passive dismiss path is blocked and the only exit is the explicit confirm.
 * On reveal it is re-readable through the secret route, so it closes normally.
 */

import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useState } from "react";

import { Check, Copy, Info } from "@admin/components/icons";
import { UI } from "@admin/constants/ui";

export interface WebhookSecretModalProps {
  open: boolean;
  secrets: string[] | null;
  /** Create flow: shown once, dismiss blocked until confirmed. */
  oneTime: boolean;
  onClose: () => void;
}

const SecretRow: React.FC<{ secret: string }> = ({ secret }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    });
  }, [secret]);

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 overflow-x-auto rounded-none border border-border bg-primary/5 px-3 py-2 font-mono text-sm break-all">
        {secret}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy secret"}
        className="shrink-0"
      >
        {copied ? (
          <Check className="h-4 w-4 text-success-600" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
};

export const WebhookSecretModal: React.FC<WebhookSecretModalProps> = ({
  open,
  secrets,
  oneTime,
  onClose,
}) => {
  const list = secrets ?? [];

  return (
    <Dialog open={open} onOpenChange={oneTime ? undefined : onClose}>
      <DialogContent
        className="sm:max-w-lg"
        aria-describedby="webhook-secret-description"
        onInteractOutside={oneTime ? e => e.preventDefault() : undefined}
        onEscapeKeyDown={oneTime ? e => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {oneTime ? "Save your signing secret" : "Signing secret"}
          </DialogTitle>
          <DialogDescription id="webhook-secret-description" asChild>
            <div className="mt-1">
              <Alert variant="info" role="status">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {oneTime
                    ? "This secret will not be shown again. Copy and store it now — it is used to verify the webhook-signature header on every delivery."
                    : "Use this to verify the webhook-signature header on each delivery. Keep it secret; treat it like a password."}
                </AlertDescription>
              </Alert>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {list.map(secret => (
            <SecretRow key={secret} secret={secret} />
          ))}
        </div>

        <DialogFooter>
          <Button type="button" onClick={onClose} className="w-full sm:w-auto">
            {oneTime ? "I've saved my secret" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
