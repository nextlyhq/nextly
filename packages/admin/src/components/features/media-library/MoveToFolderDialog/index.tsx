"use client";

/**
 * MoveToFolderDialog Component
 *
 * Dialog for moving media files to a different folder with:
 * - List of available folders (via shared FolderTreePicker)
 * - Option to move to root (no folder)
 * - Inline "New folder" creation (at root or inside the selected folder)
 * - Bulk move support (multiple media files)
 *
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@revnixhq/ui";
import * as React from "react";

import { FolderPlus } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  useCreateFolder,
  useMoveMediaToFolder,
  useRootFolders,
} from "@admin/hooks/queries/useMedia";
import type { MediaFolder } from "@admin/types/media";

import { FolderTreePicker } from "../FolderTreePicker";

export interface MoveToFolderDialogProps {
  /**
   * Dialog open state
   */
  open: boolean;

  /**
   * Callback when dialog open state changes
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Media IDs to move
   */
  mediaIds: string[];

  /**
   * Current folder ID of the media
   */
  currentFolderId?: string | null;

  /**
   * Callback when move is successful
   */
  onSuccess?: () => void;
}

/**
 * MoveToFolderDialog component
 */
export function MoveToFolderDialog({
  open,
  onOpenChange,
  mediaIds,
  currentFolderId,
  onSuccess,
}: MoveToFolderDialogProps) {
  // Root folders are fetched for the "no folders yet" hint. TanStack dedupes
  // this query with the FolderTreePicker's own call.
  const { data: rootFolders, isLoading: foldersLoading } = useRootFolders();
  const hasFolders = (rootFolders?.length ?? 0) > 0;

  // Mutations
  const { mutate: moveMedia, isPending } = useMoveMediaToFolder();
  const {
    mutate: createFolder,
    isPending: isCreating,
    error: createError,
    reset: resetCreate,
  } = useCreateFolder();

  // Selected destination folder. Starts at the current folder so the Move
  // button stays disabled until the user picks something different.
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null>(
    currentFolderId ?? null
  );
  // Folder name is needed only for the "Inside [folder]" label in the inline
  // create-folder form. It's populated when the user picks a folder via the
  // picker; unknown on the initial render (only an id is passed in).
  const [selectedFolderName, setSelectedFolderName] = React.useState<
    string | null
  >(null);

  const handleSelect = React.useCallback((folder: MediaFolder | null) => {
    setSelectedFolderId(folder?.id ?? null);
    setSelectedFolderName(folder?.name ?? null);
  }, []);

  // Inline create-folder form state
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [createInsideSelected, setCreateInsideSelected] = React.useState(false);

  // Reset state each time the dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedFolderId(currentFolderId ?? null);
      setSelectedFolderName(null);
      setIsCreatingFolder(false);
      setNewFolderName("");
      resetCreate();
    }
  }, [open, currentFolderId, resetCreate]);

  const [moveProgress, setMoveProgress] = React.useState<{
    current: number;
    total: number;
  } | null>(null);

  const handleMove = React.useCallback(async () => {
    if (mediaIds.length === 0) return;

    setMoveProgress({ current: 0, total: mediaIds.length });

    const results = await Promise.allSettled(
      mediaIds.map(
        mediaId =>
          new Promise<void>((resolve, reject) => {
            moveMedia(
              { mediaId, folderId: selectedFolderId },
              {
                onSuccess: () => {
                  setMoveProgress(prev =>
                    prev ? { ...prev, current: prev.current + 1 } : null
                  );
                  resolve();
                },
                onError: (error: Error) => reject(error),
              }
            );
          })
      )
    );

    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    const total = mediaIds.length;
    const succeeded = total - failed.length;
    const destination = selectedFolderName ?? "Root";
    const fileLabel = total === 1 ? "file" : "files";

    setMoveProgress(null);
    onOpenChange(false);
    onSuccess?.();

    if (failed.length === 0) {
      toast.success(
        succeeded === 1 ? "File moved" : `${succeeded} ${fileLabel} moved`,
        { description: `Moved to ${destination}.` }
      );
    } else if (succeeded === 0) {
      const firstError =
        failed[0].reason instanceof Error
          ? failed[0].reason.message
          : "Failed to move media.";
      toast.error(
        total === 1 ? "Failed to move file" : `Failed to move ${total} files`,
        { description: firstError }
      );
    } else {
      toast.error(`Moved ${succeeded} of ${total}; ${failed.length} failed`, {
        description: `Some files couldn't be moved to ${destination}.`,
      });
    }
  }, [
    mediaIds,
    selectedFolderId,
    selectedFolderName,
    moveMedia,
    onOpenChange,
    onSuccess,
  ]);

  const hasChanged = selectedFolderId !== (currentFolderId ?? null);

  // Whether we know enough about the selected folder to offer "Inside [name]"
  const canCreateInsideSelected = Boolean(
    selectedFolderId && selectedFolderName
  );

  const handleStartCreate = React.useCallback(() => {
    setNewFolderName("");
    setCreateInsideSelected(canCreateInsideSelected);
    resetCreate();
    setIsCreatingFolder(true);
  }, [canCreateInsideSelected, resetCreate]);

  const handleCancelCreate = React.useCallback(() => {
    setIsCreatingFolder(false);
    setNewFolderName("");
    resetCreate();
  }, [resetCreate]);

  const handleSubmitCreate = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = newFolderName.trim();
      if (!trimmed) return;

      const parentId =
        createInsideSelected && selectedFolderId ? selectedFolderId : undefined;

      createFolder(
        { name: trimmed, parentId },
        {
          onSuccess: newFolder => {
            handleSelect(newFolder);
            setIsCreatingFolder(false);
            setNewFolderName("");
          },
        }
      );
    },
    [
      newFolderName,
      createInsideSelected,
      selectedFolderId,
      createFolder,
      handleSelect,
    ]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Move to Folder</DialogTitle>
          <DialogDescription>
            {mediaIds.length === 1
              ? "Select a folder to move this media file to."
              : `Select a folder to move ${mediaIds.length} media files to.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[400px] space-y-2 overflow-y-auto py-4">
          {/* Inline create-folder form, or trigger button */}
          {isCreatingFolder ? (
            <form
              onSubmit={handleSubmitCreate}
              className="space-y-2 rounded-none border border-dashed border-primary/40 bg-primary/5 p-3"
            >
              <Input
                autoFocus
                placeholder="Folder name"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                disabled={isCreating}
                aria-label="New folder name"
              />
              {canCreateInsideSelected && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      checked={!createInsideSelected}
                      onChange={() => setCreateInsideSelected(false)}
                      disabled={isCreating}
                    />
                    At root
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      checked={createInsideSelected}
                      onChange={() => setCreateInsideSelected(true)}
                      disabled={isCreating}
                    />
                    Inside{" "}
                    <span className="font-medium text-foreground">
                      {selectedFolderName}
                    </span>
                  </label>
                </div>
              )}
              {createError && (
                <div className="text-xs text-destructive">
                  {createError.message || "Failed to create folder"}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelCreate}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isCreating || !newFolderName.trim()}
                >
                  {isCreating ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={handleStartCreate}
              className="flex w-full items-center gap-2 rounded-none border border-dashed border-border px-4 py-2.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent"
            >
              <FolderPlus className="h-4 w-4" />
              <span>New folder</span>
            </button>
          )}

          <FolderTreePicker
            selectedFolderId={selectedFolderId}
            onSelect={handleSelect}
            disabledFolderId={currentFolderId ?? null}
            rootLabel="Root (No Folder)"
            rootDescription="Move to unorganized media"
          />

          {!foldersLoading && !hasFolders && !isCreatingFolder && (
            <div className="py-2 text-center text-sm text-muted-foreground">
              No folders yet — use{" "}
              <span className="font-medium">New folder</span> above to create
              one.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => { void handleMove(); }}
            disabled={
              isPending ||
              moveProgress !== null ||
              !hasChanged ||
              mediaIds.length === 0
            }
          >
            {moveProgress
              ? `Moving ${moveProgress.current} of ${moveProgress.total}...`
              : isPending
                ? "Moving..."
                : mediaIds.length === 1
                  ? "Move File"
                  : `Move ${mediaIds.length} Files`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
