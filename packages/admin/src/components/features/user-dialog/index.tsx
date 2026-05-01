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

import { Loader2, AlertTriangle } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import type { UserDeleteDialogProps } from "@admin/types/ui/user";

export function UserDeleteDialog({
  open,
  isLoading,
  user,
  onOpenChange,
  onConfirm,
}: UserDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  const isPending = isDeleting || isLoading;

  const handleConfirm = useCallback(() => {
    if (isPending) return;

    try {
      setIsDeleting(true);
      setError(null);

      onConfirm();

      toast.success("User deleted successfully", {
        description: `The user "${user?.name}" has been removed.`,
      });

      // Parent handles open/close
      onOpenChange(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(`Failed to delete user: ${errorMessage}`);
      toast.error("Error deleting user", { description: errorMessage });
    } finally {
      setIsDeleting(false);
    }
  }, [onConfirm, isPending, onOpenChange, user]);

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="delete-dialog-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle id="delete-dialog-title">Delete User?</DialogTitle>
          <DialogDescription id="delete-dialog-description">
            Are you sure you want to delete <strong>{user.name}</strong>? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
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
            disabled={isPending}
            ref={deleteButtonRef}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
