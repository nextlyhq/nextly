import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@revnixhq/ui";
import * as React from "react";

import { AlertTriangle } from "@admin/components/icons";
import {
  useDeleteFolder,
  useFolderContents,
} from "@admin/hooks/queries/useMedia";

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
}: DeleteFolderDialogProps) {
  const { data: folderContents, isLoading: isLoadingContents } =
    useFolderContents(folderId);
  const { mutate: deleteFolderMutation, isPending } = useDeleteFolder();

  const subfolderCount = folderContents?.subfolders?.length ?? 0;
  const mediaCount = folderContents?.mediaFiles?.length ?? 0;
  const hasContents = subfolderCount > 0 || mediaCount > 0;
  const displayName =
    folderName ?? folderContents?.folder?.name ?? "this folder";

  const handleDelete = React.useCallback(() => {
    if (!folderId) return;

    deleteFolderMutation(
      { folderId, deleteContents: true },
      {
        onSuccess: () => {
          onOpenChange(false);
          onSuccess?.();
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
