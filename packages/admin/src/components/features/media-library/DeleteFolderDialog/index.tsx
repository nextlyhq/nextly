"use client";

import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Button,
} from "@nextlyhq/ui";
import * as React from "react";

import { AlertTriangle } from "@admin/components/icons";
import {
  useDeleteFolder,
  useFolderContents,
} from "@admin/hooks/queries/useMedia";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

export interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  folderName?: string;
  onSuccess?: () => void;
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folderId,
  folderName,
  onSuccess,
}: DeleteFolderDialogProps): React.JSX.Element {
  const {
    data: folderContents,
    isFetching: isLoadingContents,
    refetch: refetchContents,
  } = useFolderContents(folderId);
  // The count is read again whenever the dialog opens. A cached answer can
  // predate an upload or a delete in this folder, and confirming deletes what
  // the folder holds now, not what it held when it was last read.
  React.useEffect(() => {
    if (open && folderId !== null) void refetchContents();
  }, [open, folderId, refetchContents]);
  const { mutate: deleteFolderMutation, isPending } = useDeleteFolder();
  // Why the server refused the delete, said in the dialog, which stays open
  // so the person can see it: a folder holding items still inside their
  // Undo window, say. Cleared each time the dialog opens.
  const [refusal, setRefusal] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) setRefusal(null);
  }, [open, folderId]);

  const subfolderCount = folderContents?.subfolders?.length ?? 0;
  // Every file the folder holds, which the server counts: `files` is one
  // page of them.
  const mediaCount = folderContents?.meta?.total ?? 0;
  const hasContents = subfolderCount > 0 || mediaCount > 0;
  const displayName =
    folderName ?? folderContents?.folder?.name ?? "this folder";

  const handleDelete = React.useCallback(() => {
    if (!folderId) return;

    setRefusal(null);
    deleteFolderMutation(
      { folderId, deleteContents: true },
      {
        onSuccess: () => {
          onOpenChange(false);
          onSuccess?.();
        },
        onError: error => {
          setRefusal(
            apiErrorMessage(error, "The folder could not be deleted.")
          );
        },
      }
    );
  }, [folderId, deleteFolderMutation, onOpenChange, onSuccess]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {hasContents && (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            Delete &ldquo;{displayName}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {isLoadingContents ? (
                <p>Checking folder contents...</p>
              ) : hasContents ? (
                <>
                  <p>This folder contains:</p>
                  <ul className="list-inside list-disc space-y-1 pl-2">
                    {subfolderCount > 0 && (
                      <li>
                        {subfolderCount}{" "}
                        {subfolderCount === 1 ? "subfolder" : "subfolders"}
                      </li>
                    )}
                    {mediaCount > 0 && (
                      <li>
                        {mediaCount} media {mediaCount === 1 ? "file" : "files"}
                      </li>
                    )}
                  </ul>
                  <p className="font-medium text-destructive">
                    {subfolderCount > 0 && mediaCount > 0
                      ? "All subfolders and media files"
                      : subfolderCount > 0
                        ? "All subfolders"
                        : "All media files"}{" "}
                    will be permanently deleted from the database and storage.
                    This action cannot be undone.
                  </p>
                  <p className="text-muted-foreground">
                    To keep media files, move them to another folder first.
                  </p>
                </>
              ) : (
                <p>This empty folder will be permanently deleted.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {/* The title above the reason, beside the icon. */}
            <div className="flex min-w-0 flex-col gap-1">
              <AlertTitle>Couldn&apos;t delete the folder</AlertTitle>
              <AlertDescription>{refusal}</AlertDescription>
            </div>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending || isLoadingContents}
          >
            {isPending
              ? "Deleting..."
              : hasContents
                ? "Delete Everything"
                : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
