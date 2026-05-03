"use client";

/**
 * CreateFolderDialog Component
 *
 * Dialog for creating a new media folder with:
 * - Folder name (required)
 * - Description (optional)
 * - Parent folder selection (via shared FolderTreePicker)
 *
 * ## Features
 * - Form validation (name required)
 * - Pre-selects a parent when invoked from a specific folder's context menu,
 *   but the user can change it in-dialog.
 * - Loading state during creation
 * - Error handling
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
  Label,
  Textarea,
} from "@revnixhq/ui";
import * as React from "react";

import { useCreateFolder, useRootFolders } from "@admin/hooks/queries/useMedia";
import type { CreateFolderInput, MediaFolder } from "@admin/types/media";

import { FolderTreePicker } from "../FolderTreePicker";

export interface CreateFolderDialogProps {
  /**
   * Dialog open state
   */
  open: boolean;

  /**
   * Callback when dialog open state changes
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Pre-selected parent folder ID (e.g. when invoked from a specific folder's
   * "New subfolder" action). The user can still change this in-dialog.
   */
  parentId?: string;

  /**
   * Callback when folder is created successfully
   */
  onSuccess?: () => void;
}

/**
 * CreateFolderDialog component
 */
export function CreateFolderDialog({
  open,
  onOpenChange,
  parentId,
  onSuccess,
}: CreateFolderDialogProps) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  // Parent selection is derived so the picker reflects the `parentId` prop on
  // the very first render (no flicker while a `useEffect` catches up). The
  // user's in-dialog override takes precedence once set; it resets each time
  // the dialog re-opens.
  const [overrideParentId, setOverrideParentId] = React.useState<
    string | null | undefined
  >(undefined);
  const selectedParentId =
    overrideParentId === undefined ? (parentId ?? null) : overrideParentId;

  // Used to decide whether to render the parent picker or a "top-level" hint.
  // TanStack dedupes with the picker's own call.
  const { data: rootFolders, isLoading: foldersLoading } = useRootFolders();
  const hasFolders = (rootFolders?.length ?? 0) > 0;

  const { mutate: createFolder, isPending, error } = useCreateFolder();

  // Reset form state each time the dialog (re)opens.
  React.useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setOverrideParentId(undefined);
    }
  }, [open]);

  const handleSelectParent = React.useCallback((folder: MediaFolder | null) => {
    setOverrideParentId(folder?.id ?? null);
  }, []);

  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!name.trim()) {
        return;
      }

      const input: CreateFolderInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        parentId: selectedParentId ?? undefined,
      };

      createFolder(input, {
        onSuccess: () => {
          onOpenChange(false);
          onSuccess?.();
        },
      });
    },
    [name, description, selectedParentId, createFolder, onOpenChange, onSuccess]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {parentId ? "Create Subfolder" : "Create Folder"}
          </DialogTitle>
          <DialogDescription>
            Create a new folder to organize your media files.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Folder Name */}
          <div className="space-y-2">
            <Label htmlFor="folder-name">
              Folder Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="folder-name"
              placeholder="e.g., Product Images"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="folder-description">Description (Optional)</Label>
            <Textarea
              id="folder-description"
              placeholder="e.g., Photos of our products for the catalog"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Parent Folder Picker — only shown when folders exist */}
          {hasFolders && (
            <div className="space-y-2">
              <Label>Parent Folder (Optional)</Label>
              <div className="max-h-[200px] overflow-y-auto rounded-none  border border-primary/5 p-2">
                <FolderTreePicker
                  selectedFolderId={selectedParentId}
                  onSelect={handleSelectParent}
                  rootLabel="Root (No Parent)"
                  compact
                />
              </div>
            </div>
          )}
          {!hasFolders && !foldersLoading && (
            <p className="text-xs text-muted-foreground">
              This will be created as a top-level folder.
            </p>
          )}

          {/* Error Message */}
          {error && (
            <div className="text-sm text-destructive">
              {error.message || "Failed to create folder"}
            </div>
          )}

          {/* Footer */}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Creating..." : "Create Folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
