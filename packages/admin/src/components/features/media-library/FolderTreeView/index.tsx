"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@revnixhq/ui";
import * as React from "react";

import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Folder as FolderIconDefault,
} from "@admin/components/icons";
import {
  useFolderContents,
  useRootFolders,
  useSubfolders,
} from "@admin/hooks/queries/useMedia";
import { cn } from "@admin/lib/utils";
import type { MediaFolder } from "@admin/types/media";

export interface FolderTreeViewProps {
  activeFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  onCreateFolder: (parentId?: string) => void;
  onEditFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string, folderName: string) => void;
  className?: string;
}

export function FolderTreeView({
  activeFolderId,
  onFolderSelect,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  className,
}: FolderTreeViewProps) {
  const { data: rootFolders, isLoading } = useRootFolders();
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  const toggleExpand = React.useCallback((folderId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent, folderId: string | null) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onFolderSelect(folderId);
      } else if (e.key === "ArrowRight" && folderId) {
        e.preventDefault();
        setExpandedIds(prev => new Set(prev).add(folderId));
      } else if (e.key === "ArrowLeft" && folderId) {
        e.preventDefault();
        setExpandedIds(prev => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
      }
    },
    [onFolderSelect]
  );

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-background dark:bg-transparent border-r border-border/50",
        className
      )}
    >
      {/* Sidebar Heading */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-border/40">
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/80 dark:text-muted-foreground">
          Folders
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 hover-unified transition-colors text-slate-400"
          onClick={() => onCreateFolder()}
          title="Create folder"
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Top-level "All Media" */}
        <button
          type="button"
          onClick={() => onFolderSelect(null)}
          onKeyDown={e => handleKeyDown(e, null)}
          className={cn(
            "group flex w-full items-center px-4 py-2.5 text-sm transition-all duration-200 cursor-pointer",
            activeFolderId === null
              ? "bg-foreground text-background font-bold ring-1 ring-foreground/5"
              : "text-muted-foreground hover-subtle-row font-medium"
          )}
        >
          {/* Spacer to align with chevrons below (which are 24px wide + level margin) */}
          <div className="w-8 shrink-0" />
          <FolderIconDefault
            className={cn(
              "h-4 w-4 shrink-0 transition-colors mr-2.5",
              activeFolderId === null
                ? "text-background"
                : "text-muted-foreground/60 group-hover:text-foreground"
            )}
          />
          <span className="truncate text-xs">All Media</span>
        </button>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400/80" />
          </div>
        )}

        {/* Folder tree */}
        <div className="mt-1">
          {rootFolders?.map(folder => (
            <FolderTreeItem
              key={folder.id}
              folder={folder}
              level={0}
              isActive={activeFolderId === folder.id}
              isExpanded={expandedIds.has(folder.id)}
              expandedIds={expandedIds}
              activeFolderId={activeFolderId}
              onSelect={onFolderSelect}
              onToggle={toggleExpand}
              onCreateSubfolder={onCreateFolder}
              onEdit={onEditFolder}
              onDelete={onDeleteFolder}
              onKeyDown={handleKeyDown}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface FolderTreeItemProps {
  folder: MediaFolder;
  level: number;
  isActive: boolean;
  isExpanded: boolean;
  expandedIds: Set<string>;
  activeFolderId: string | null;
  onSelect: (folderId: string) => void;
  onToggle: (folderId: string) => void;
  onCreateSubfolder: (parentId: string) => void;
  onEdit: (folderId: string) => void;
  onDelete: (folderId: string, folderName: string) => void;
  onKeyDown: (e: React.KeyboardEvent, folderId: string) => void;
}

function FolderTreeItem({
  folder,
  level,
  isActive,
  isExpanded,
  expandedIds,
  activeFolderId,
  onSelect,
  onToggle,
  onCreateSubfolder,
  onEdit,
  onDelete,
  onKeyDown,
}: FolderTreeItemProps) {
  // Fetch subfolders to determine if we have children and for expansion
  const { data: subfoldersData } = useSubfolders(folder.id);
  const hasSubfolders = (subfoldersData?.length ?? 0) > 0;

  // Use the fetched data for expansion if active
  const subfolders = isExpanded ? subfoldersData : undefined;

  // Still fetch contents for the item count
  const { data: contents } = useFolderContents(folder.id);
  const itemCount =
    (contents?.subfolders?.length ?? 0) + (contents?.mediaFiles?.length ?? 0);

  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div>
      <div
        className={cn(
          "group flex w-full items-center transition-all duration-200 cursor-pointer relative",
          isActive
            ? "bg-foreground text-background font-bold"
            : "text-muted-foreground hover-subtle-row font-medium border-b border-transparent"
        )}
        style={{ paddingLeft: `${16 + level * 12}px` }}
        onClick={() => {
          onSelect(folder.id);
          if (hasSubfolders) onToggle(folder.id);
        }}
      >
        {/* Dropdown Indicator (Arrow on the LEFT) */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center">
          {hasSubfolders ? (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onToggle(folder.id);
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center transition-colors hover:bg-white/10 rounded-md",
                isActive
                  ? "text-background/60 hover:text-background"
                  : "text-muted-foreground/60 hover:text-foreground"
              )}
            >
              <ExpandIcon className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="w-8" />
          )}
        </div>

        {/* Folder Content */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-2">
          <FolderIconDefault
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              isActive
                ? "text-background"
                : "text-muted-foreground/60 group-hover:text-foreground"
            )}
          />
          <span className="truncate text-xs">{folder.name}</span>

          {itemCount > 0 && (
            <span
              className={cn(
                "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full transition-all duration-200",
                isActive
                  ? "bg-background/20 text-background"
                  : "bg-muted text-muted-foreground group-hover:bg-foreground group-hover:text-background"
              )}
            >
              {itemCount}
            </span>
          )}
        </div>

        {/* Context Menu (Optional/Simplified) */}
        <div
          className={cn(
            "pr-2 transition-opacity",
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover-unified"
                tabIndex={-1}
              >
                <MoreHorizontal className="h-3.5 w-3.5 text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 shadow-lg border-border/50"
            >
              <DropdownMenuItem
                onClick={() => onCreateSubfolder(folder.id)}
                className="gap-2"
              >
                <FolderPlus className="h-4 w-4 text-slate-500" />
                <span>New subfolder</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onEdit(folder.id)}
                className="gap-2"
              >
                <Pencil className="h-4 w-4 text-slate-500" />
                <span>Rename</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(folder.id, folder.name)}
                className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Recursive Sub-folders */}
      {isExpanded && (
        <div className="animate-in slide-in-from-top-1 duration-200">
          {!subfolders ? (
            <div className="py-2 pl-12 text-[10px] text-slate-400 italic">
              Loading subfolders...
            </div>
          ) : subfolders.length > 0 ? (
            subfolders.map(sub => (
              <FolderTreeItem
                key={sub.id}
                folder={sub}
                level={level + 1}
                isActive={activeFolderId === sub.id}
                isExpanded={expandedIds.has(sub.id)}
                expandedIds={expandedIds}
                activeFolderId={activeFolderId}
                onSelect={onSelect}
                onToggle={onToggle}
                onCreateSubfolder={onCreateSubfolder}
                onEdit={onEdit}
                onDelete={onDelete}
                onKeyDown={onKeyDown}
              />
            ))
          ) : (
            <div className="py-2 pl-12 text-[10px] text-slate-400 italic">
              No subfolders
            </div>
          )}
        </div>
      )}
    </div>
  );
}
