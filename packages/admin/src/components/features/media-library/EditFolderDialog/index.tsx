"use client";

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

import {
  useUpdateFolder,
  useFolderContents,
} from "@admin/hooks/queries/useMedia";
import type { UpdateFolderInput } from "@admin/types/media";

export interface EditFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  onSuccess?: () => void;
}

export function EditFolderDialog({
  open,
  onOpenChange,
  folderId,
  onSuccess,
}: EditFolderDialogProps) {
  const { data: folderContents } = useFolderContents(folderId);
  const folder = folderContents?.folder;

  const { mutate: updateFolder, isPending } = useUpdateFolder();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    if (folder && folder.id !== "root") {
      setName(folder.name);
      setDescription(folder.description ?? "");
    }
  }, [folder]);

  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !folderId) return;

      const updates: UpdateFolderInput = {
        name: name.trim(),
        description: description.trim() || undefined,
      };

      updateFolder(
        { folderId, updates },
        {
          onSuccess: () => {
            onOpenChange(false);
            onSuccess?.();
          },
        }
      );
    },
    [name, description, folderId, updateFolder, onOpenChange, onSuccess]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Folder</DialogTitle>
          <DialogDescription>
            Update folder name and description.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-folder-name">Name</Label>
            <Input
              id="edit-folder-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Folder name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-folder-description">Description</Label>
            <Textarea
              id="edit-folder-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button size="md" type="submit" disabled={!name.trim() || isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
