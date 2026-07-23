"use client";

/**
 * DeleteWebhookDialog — confirms retiring an endpoint. Delete is a soft-delete:
 * the endpoint stops delivering and its secret/headers are cleared, but its
 * delivery history is kept. The parent owns the mutation; this only confirms.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type React from "react";

import { Loader2 } from "@admin/components/icons";
import type { WebhookEndpointSummary } from "@admin/types/webhooks";

export interface DeleteWebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhook: WebhookEndpointSummary | null;
  onConfirm: () => void;
  isPending: boolean;
}

export const DeleteWebhookDialog: React.FC<DeleteWebhookDialogProps> = ({
  open,
  onOpenChange,
  webhook,
  onConfirm,
  isPending,
}) => {
  if (!webhook) return null;

  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="delete-webhook-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle>Delete this endpoint?</DialogTitle>
          <DialogDescription id="delete-webhook-description">
            Deleting <strong>&ldquo;{webhook.name}&rdquo;</strong> stops all
            deliveries and clears its signing secret. Its delivery history is
            kept, but the endpoint cannot be restored.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete endpoint"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
