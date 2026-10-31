"use client";

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
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
  LayoutGrid,
  Type,
} from "@admin/components/icons";
import { useRootFolders, useSubfolders } from "@admin/hooks/queries/useMedia";
import { cn } from "@admin/lib/utils";
import type { MediaFolder, MediaLibraryView } from "@admin/types/media";

import { useMediaLibraryCounts } from "../media-library-queries";
import {
  MEDIA_LIBRARY_VIEW_LABELS,
  setMediaLibraryView,
  useMediaLibraryView,
} from "../media-library-view";

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
}: FolderTreeViewProps): React.JSX.Element {
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
        setMediaLibraryView(null);
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

  const counts = useMediaLibraryCounts().data;
  const view = useMediaLibraryView();

  // A folder clears the view: a view spans every folder.
  const selectFolder = React.useCallback(
    (folderId: string | null) => {
      setMediaLibraryView(null);
      onFolderSelect(folderId);
    },
    [onFolderSelect]
  );
  // A view is across every folder, so it leaves the folder too.
  const selectView = React.useCallback(
    (next: MediaLibraryView) => {
      onFolderSelect(null);
      setMediaLibraryView(next);
    },
    [onFolderSelect]
  );

  return (
    <nav
      aria-label="Media library"
      className={cn("flex flex-col h-full pt-1 pb-6", className)}
    >
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        <LibraryRow
          label="All media"
          icon={<LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />}
          count={counts?.all}
          current={activeFolderId === null && view === null}
          onSelect={() => selectFolder(null)}
        />

        <h3 className="px-3 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
          Views
        </h3>
        <LibraryRow
          label={MEDIA_LIBRARY_VIEW_LABELS["missing-alt"]}
          icon={<Type className="h-4 w-4 shrink-0" aria-hidden="true" />}
          count={counts?.missingAltText}
          // Work left to do stands out; none reads as a plain zero.
          emphasize={(counts?.missingAltText ?? 0) > 0}
          current={view === "missing-alt"}
          onSelect={() => selectView("missing-alt")}
        />
        <LibraryRow
          label={MEDIA_LIBRARY_VIEW_LABELS.unused}
          icon={<UnusedIcon />}
          // Until the usage record covers older content, the count would
          // name items content still uses, so none is shown.
          count={
            counts?.usageRecorded ? (counts.unused ?? undefined) : undefined
          }
          countHint={
            counts && !counts.usageRecorded ? "Still being counted" : undefined
          }
          current={view === "unused"}
          onSelect={() => selectView("unused")}
        />

        <div className="flex items-center justify-between pl-3 pr-1 pt-3">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Folders
          </h3>
          <Button
            variant="ghost"
            size="md"
            className="h-8 w-8 p-0 hover:bg-primary/5 transition-colors text-muted-foreground"
            onClick={() => onCreateFolder()}
            aria-label="New folder"
            title="New folder"
          >
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Folder tree */}
        <div>
          {rootFolders?.map(folder => (
            <FolderTreeItem
              key={folder.id}
              folder={folder}
              level={0}
              isActive={activeFolderId === folder.id}
              isExpanded={expandedIds.has(folder.id)}
              expandedIds={expandedIds}
              activeFolderId={activeFolderId}
              counts={counts?.folders}
              onSelect={selectFolder}
              onToggle={toggleExpand}
              onCreateSubfolder={onCreateFolder}
              onEdit={onEditFolder}
              onDelete={onDeleteFolder}
              onKeyDown={handleKeyDown}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

/** The mark for items nothing uses: a circle struck through. */
function UnusedIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </svg>
  );
}

/**
 * One row above the folders: All media or a view, with its count. The row
 * on screen says so to assistive technology (`aria-current`).
 */
function LibraryRow({
  label,
  icon,
  count,
  countHint,
  emphasize = false,
  current,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  count: number | undefined;
  /** Said in place of a count that cannot be given yet. */
  countHint?: string;
  emphasize?: boolean;
  current: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      // The name said with its count, or with why there is none yet.
      aria-label={
        count !== undefined
          ? `${label}, ${count}`
          : countHint
            ? `${label}, ${countHint}`
            : label
      }
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        current
          ? "bg-primary/5 font-bold text-primary"
          : "font-medium text-muted-foreground hover:bg-primary/5 hover:text-foreground"
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined &&
        (emphasize ? (
          <Badge
            variant="warning"
            className="text-xs font-semibold tabular-nums"
          >
            {count}
          </Badge>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ))}
      {count === undefined && countHint && (
        <span
          className="text-xs text-muted-foreground"
          title={countHint}
          aria-hidden="true"
        >
          …
        </span>
      )}
    </button>
  );
}

interface FolderTreeItemProps {
  folder: MediaFolder;
  level: number;
  isActive: boolean;
  isExpanded: boolean;
  expandedIds: Set<string>;
  activeFolderId: string | null;
  /** Each folder's own item count, by id; a folder with none is absent. */
  counts: Record<string, number> | undefined;
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
  counts,
  onSelect,
  onToggle,
  onCreateSubfolder,
  onEdit,
  onDelete,
  onKeyDown,
}: FolderTreeItemProps) {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  // Subfolders are asked for only when the folder is opened. Asking for every
  // folder up front (and for each one's whole contents, to draw a count) cost
  // two requests per folder on every visit, each downloading every file the
  // folder held. The answer stays cached under the folder's id after closing.
  const {
    data: subfoldersData,
    isFetched,
    isError,
    refetch,
  } = useSubfolders(folder.id, { enabled: isExpanded });
  // Until a folder has been opened it may have subfolders, so it keeps its
  // expander; once the answer says none, the expander goes. An open folder
  // keeps it whatever the answer, so "No subfolders" or a failed lookup can
  // still be closed. Creating a subfolder adds it to this cached answer, so a
  // folder found empty earlier gets its expander back.
  // A failed lookup keeps it too, so a folder closed before retrying can be
  // opened again to retry.
  const hasSubfolders =
    isExpanded || !isFetched || isError || (subfoldersData?.length ?? 0) > 0;

  // Use the fetched data for expansion if active
  const subfolders = isExpanded ? subfoldersData : undefined;

  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div>
      <div
        className={cn(
          "group flex w-full items-center transition-all duration-200 cursor-pointer relative rounded-md mx-0.5",
          isActive
            ? "bg-primary/5 text-primary font-bold"
            : "text-muted-foreground hover:bg-primary/5 font-medium"
        )}
        style={{ paddingLeft: `${4 + level * 10}px` }}
        onClick={() => {
          onSelect(folder.id);
          if (hasSubfolders) onToggle(folder.id);
        }}
      >
        {/* Dropdown Indicator (Arrow on the LEFT) */}
        <div className="flex h-8 w-6 shrink-0 items-center justify-center">
          {hasSubfolders ? (
            <button
              type="button"
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`}
              aria-expanded={isExpanded}
              onClick={e => {
                e.stopPropagation();
                onToggle(folder.id);
              }}
              className={cn(
                "flex h-8 w-6 items-center justify-center transition-colors rounded-md cursor-pointer",
                // Full-strength primary so the active expander icon meets contrast.
                isActive
                  ? "text-primary group-hover:text-primary"
                  : "text-muted-foreground group-hover:text-foreground"
              )}
            >
              <ExpandIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <div className="w-6" />
          )}
        </div>

        {/* The folder itself: a button, so it is reached and opened by
            keyboard as by pointer. */}
        <button
          type="button"
          aria-label={
            counts ? `${folder.name}, ${counts[folder.id] ?? 0}` : folder.name
          }
          aria-current={isActive ? "page" : undefined}
          onClick={event => {
            event.stopPropagation();
            onSelect(folder.id);
            if (hasSubfolders) onToggle(folder.id);
          }}
          onKeyDown={event => onKeyDown(event, folder.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <FolderIconDefault
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground group-hover:text-foreground"
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-xs">{folder.name}</span>
          {counts && (
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {counts[folder.id] ?? 0}
            </span>
          )}
        </button>

        {/* Context Menu (Optional/Simplified) */}
        <div
          className={cn(
            "pr-2 transition-opacity",
            isActive || isMenuOpen
              ? "opacity-100 cursor-pointer"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 cursor-pointer"
          )}
        >
          <DropdownMenu onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${folder.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreHorizontal
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 shadow-none border-border"
            >
              <DropdownMenuItem
                onClick={() => onCreateSubfolder(folder.id)}
                className="gap-2"
              >
                <FolderPlus className="h-4 w-4 text-muted-foreground" />
                <span>New subfolder</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onEdit(folder.id)}
                className="gap-2"
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
                <span>Rename</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(folder.id, folder.name)}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Recursive Sub-folders */}
      {isExpanded && (
        <div className="animate-in slide-in-from-top-1 duration-200">
          {isError && !subfolders ? (
            <div className="flex items-center gap-2 py-2 pl-12 text-xs text-muted-foreground">
              <span>Couldn&apos;t load subfolders.</span>
              <button
                type="button"
                onClick={() => void refetch()}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : !subfolders ? (
            <div className="py-2 pl-12 text-xs text-muted-foreground italic">
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
                counts={counts}
                onSelect={onSelect}
                onToggle={onToggle}
                onCreateSubfolder={onCreateSubfolder}
                onEdit={onEdit}
                onDelete={onDelete}
                onKeyDown={onKeyDown}
              />
            ))
          ) : (
            <div className="py-2 pl-12 text-xs text-muted-foreground italic">
              No subfolders
            </div>
          )}
        </div>
      )}
    </div>
  );
}
