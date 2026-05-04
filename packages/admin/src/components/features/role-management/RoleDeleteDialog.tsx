"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@revnixhq/ui";
import { useState, useCallback, useRef } from "react";

import {
  Loader2,
  AlertTriangle,
  ShieldAlert,
  AlertCircle,
} from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import type { RoleDeleteDialogProps } from "@admin/types/role";

export function RoleDeleteDialog({
  open,
  isLoading,
  role,
  onOpenChange,
  onConfirm,
}: RoleDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  const isSystemRole = role?.isSystemRole ?? false;
  const isPending = isDeleting || isLoading;
  const deleteDisabled = isPending || isSystemRole;

  const handleConfirm = useCallback(() => {
    if (isPending) return;

    try {
      setIsDeleting(true);
      setError(null);

      if (isSystemRole) {
        const msg =
          "System roles cannot be deleted as they are required for core functionality";
        setError(msg);
        toast.error("Cannot delete system role", { description: msg });
        return;
      }

      onConfirm();

      toast.success("Role deleted successfully", {
        description: `The role "${role?.name}" has been removed.`,
      });

      // Parent handles open/close
      onOpenChange(false);
    } catch (err) {
      let errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";

      if (
        errorMessage.includes("foreign key") ||
        errorMessage.includes("constraint")
      ) {
        errorMessage =
          "This role cannot be deleted because it is still assigned to users. Remove all user assignments first.";
      } else if (errorMessage.includes("permission")) {
        errorMessage = "You do not have permission to delete this role.";
      } else if (errorMessage.includes("network")) {
        errorMessage =
          "Network error: Please check your connection and try again.";
      }

      setError(`Failed to delete role: ${errorMessage}`);
      toast.error("Error deleting role", { description: errorMessage });
    } finally {
      setIsDeleting(false);
    }
  }, [onConfirm, isPending, role, isSystemRole, onOpenChange]);

  if (!role) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="delete-dialog-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle id="delete-dialog-title">Delete Role?</DialogTitle>
          <DialogDescription id="delete-dialog-description">
            Are you sure you want to delete <strong>{role.name}</strong>? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {isSystemRole && (
          <Alert variant="destructive" className="mb-4">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>System Role Protection</AlertTitle>
            <AlertDescription>
              System roles cannot be deleted as they are required for the
              application to function properly.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!isSystemRole && !error && (
          <Alert variant="warning" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              Deleting a role will remove it from all assigned users. Users with
              only this role may lose access.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => { void handleConfirm(); }}
            disabled={deleteDisabled}
            ref={deleteButtonRef}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
