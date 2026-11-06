"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { SendTestPanel, type TestableProvider } from "./SendTestPanel";

/**
 * "Send a test" for an existing provider, from its row or its page: the same
 * panel the setup ends with, so a test reads the same wherever it is sent.
 */
export function SendTestDialog({
  open,
  onOpenChange,
  provider,
  providerName,
  providerLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: TestableProvider | null;
  /** The provider's own name, such as "Office SMTP". */
  providerName: string;
  /** The provider type's label, such as "SMTP". */
  providerLabel: string;
}): JSX.Element | null {
  if (!provider) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send a test</DialogTitle>
          <DialogDescription>
            A real email through <strong>{providerName}</strong>.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by provider, so a test's result never carries over to the
            next provider the dialog opens for. */}
        <SendTestPanel
          key={provider.id}
          provider={provider}
          providerLabel={providerLabel}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
