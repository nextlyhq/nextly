"use client";

/**
 * RevokeApiKeyDialog
 *
 * Confirmation dialog shown before permanently revoking an API key.
 * Revocation is a soft-delete — `isActive` is set to false and the row
 * is preserved for audit purposes.
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

import { Loader2 } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { useRevokeApiKey } from "@admin/hooks/queries/useApiKeys";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

// ============================================================
// Props
// ============================================================

export interface RevokeApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key to revoke, or null when the dialog is closed. */
  apiKey: ApiKeyMeta | null;
}

// ============================================================
// Component
// ============================================================

export const RevokeApiKeyDialog: React.FC<RevokeApiKeyDialogProps> = ({
  open,
  onOpenChange,
  apiKey,
}) => {
  const { mutate: doRevoke, isPending } = useRevokeApiKey();

  if (!apiKey) return null;

  const handleConfirm = () => {
    doRevoke(apiKey.id, {
      onSuccess: () => {
        toast.success("API key revoked", {
          description: `"${apiKey.name}" has been revoked. Any integrations using this key will no longer work.`,
        });
        onOpenChange(false);
      },
      onError: (err: Error) => {
        toast.error("Revocation failed", {
          description: err.message || "Failed to revoke the API key.",
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="revoke-key-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle>Revoke API key?</DialogTitle>
          <DialogDescription id="revoke-key-description">
            Revoking <strong>&ldquo;{apiKey.name}&rdquo;</strong> will
            immediately invalidate it. Any integrations using this key will stop
            working. This cannot be undone.
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
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Revoking…
              </>
            ) : (
              "Revoke key"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
