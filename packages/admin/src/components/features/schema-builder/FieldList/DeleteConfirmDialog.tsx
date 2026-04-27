/**
 * DeleteConfirmDialog Component
 *
 * Confirmation dialog shown before deleting a field.
 * Warns about nested field deletion when applicable.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@revnixhq/ui";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldName: string;
  hasNestedFields: boolean;
  nestedCount: number;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  fieldName,
  hasNestedFields,
  nestedCount,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Field?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{fieldName || "this field"}"?
            {hasNestedFields && nestedCount > 0 && (
              <>
                {" "}
                This will also delete {nestedCount} nested{" "}
                {nestedCount === 1 ? "field" : "fields"}.
              </>
            )}{" "}
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
