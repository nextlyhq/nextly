"use client";

/**
 * FolderCardsRow Component
 *
 * The media page's inline folder navigation: a compact row of folder cards
 * for the CURRENT level (root folders at the root, subfolders inside a
 * folder), each with a context menu for folder CRUD.
 *
 * This row renders regardless of whether the folder tree sidebar is visible.
 * The tree is a hierarchy overview; this row is the drill-down path. Keeping
 * both always available means toggling the tree only shows/hides the tree -
 * it never relocates folder navigation (the old behavior swapped between two
 * different folder UIs and was reported as confusing).
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";

import {
  Folder as FolderIconComponent,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";
import type { MediaFolder } from "@admin/types/media";

export interface FolderCardsRowProps {
  /** Folders of the current level (root folders or the active folder's subfolders). */
  folders: MediaFolder[];
  activeFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  onCreateSubfolder: (parentId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string, folderName: string) => void;
  /** Which folder's context menu is open (kept by the parent so cards stay controlled). */
  openMenuId: string | null;
  onOpenMenuChange: (folderId: string | null) => void;
}

export function FolderCardsRow({
  folders,
  activeFolderId,
  onFolderSelect,
  onCreateSubfolder,
  onRenameFolder,
  onDeleteFolder,
  openMenuId,
  onOpenMenuChange,
}: FolderCardsRowProps) {
  if (folders.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {folders.map(folder => {
        const isActive = activeFolderId === folder.id;
        return (
          <div key={folder.id} className="group relative">
            <button
              type="button"
              onClick={() => onFolderSelect(folder.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-none border border-border px-3 py-3 text-left transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-primary/5 ring-1 ring-primary/20"
                  : "bg-card hover:bg-primary/5 hover:border-border-strong"
              )}
            >
              <FolderIconComponent
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-xs font-semibold transition-colors",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-foreground"
                  )}
                >
                  {folder.name}
                </p>
              </div>
            </button>

            {/* Folder Context Menu */}
            <div
              className={cn(
                "absolute top-2 right-2 transition-opacity",
                isActive || openMenuId === folder.id
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
              )}
            >
              <DropdownMenu
                open={openMenuId === folder.id}
                onOpenChange={open => onOpenMenuChange(open ? folder.id : null)}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Folder actions for ${folder.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-none hover:bg-primary/5 transition-colors cursor-pointer!"
                    onClick={e => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-48 shadow-none border-border"
                >
                  <DropdownMenuItem
                    onClick={e => {
                      e.stopPropagation();
                      onCreateSubfolder(folder.id);
                    }}
                    className="gap-2 cursor-pointer"
                  >
                    <FolderPlus className="h-4 w-4 text-muted-foreground" />
                    <span>New subfolder</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={e => {
                      e.stopPropagation();
                      onRenameFolder(folder.id);
                    }}
                    className="gap-2 cursor-pointer"
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                    <span>Rename</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={e => {
                      e.stopPropagation();
                      onDeleteFolder(folder.id, folder.name);
                    }}
                    className="gap-2 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
    </div>
  );
}
