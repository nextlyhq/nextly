"use client";

/**
 * RotateSecretDialog — confirms rotating an endpoint's signing secret and picks
 * the overlap window. A rotation mints a new primary secret and keeps the old
 * one valid for the chosen window so a receiver can switch over without dropping
 * a delivery; "Expire immediately" gives no overlap. The parent owns the
 * mutation and receives the chosen window on confirm.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type React from "react";
import { useEffect, useState } from "react";

import { Loader2 } from "@admin/components/icons";
import {
  WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS,
  WEBHOOK_ROTATION_WINDOWS,
} from "@admin/types/webhooks";

export interface RotateSecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Endpoint name, shown so the operator knows what they are rotating. */
  webhookName: string;
  onConfirm: (overlapSeconds: number) => void;
  isPending: boolean;
}

export const RotateSecretDialog: React.FC<RotateSecretDialogProps> = ({
  open,
  onOpenChange,
  webhookName,
  onConfirm,
  isPending,
}) => {
  const [overlapSeconds, setOverlapSeconds] = useState<number>(
    WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS
  );

  // Reset to the default window each time the dialog opens, so a previous
  // selection does not silently carry into the next rotation.
  useEffect(() => {
    if (open) setOverlapSeconds(WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="rotate-secret-description"
      >
        <DialogHeader>
          <DialogTitle>Rotate signing secret?</DialogTitle>
          <DialogDescription id="rotate-secret-description">
            A new signing secret becomes the primary for{" "}
            <strong>&ldquo;{webhookName}&rdquo;</strong> and is shown once. The
            current secret keeps working for the overlap window below so your
            receiver can switch over, then stops signing. Deliveries during the
            window are signed with both.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label
            htmlFor="rotate-overlap"
            className="text-sm font-medium text-foreground"
          >
            Keep the old secret valid for
          </label>
          <Select
            value={String(overlapSeconds)}
            onValueChange={value => setOverlapSeconds(Number(value))}
            disabled={isPending}
          >
            <SelectTrigger id="rotate-overlap" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEBHOOK_ROTATION_WINDOWS.map(window => (
                <SelectItem key={window.seconds} value={String(window.seconds)}>
                  {window.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(overlapSeconds)}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Rotating…
              </>
            ) : (
              "Rotate secret"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
