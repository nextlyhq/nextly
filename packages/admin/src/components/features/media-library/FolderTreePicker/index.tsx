"use client";

import * as React from "react";

import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
} from "@admin/components/icons";
import {
  useFolderById,
  useRootFolders,
  useSubfolders,
} from "@admin/hooks/queries/useMedia";
import { cn } from "@admin/lib/utils";
import type { MediaFolder } from "@admin/types/media";

export interface FolderTreePickerProps {
  /**
   * Currently selected folder id. `null` means the root / no-folder option
   * is selected.
   */
  selectedFolderId: string | null;

  /**
   * Fired when the user picks a folder, or `null` when they pick the root
   * option. Receives the full folder so the parent can display metadata
   * (e.g. the folder's name) without a second lookup.
   */
  onSelect: (folder: MediaFolder | null) => void;

  /**
   * Folder id that cannot be selected (e.g. the folder a media file is
   * currently in). Rendered with a "(Current)" badge and disabled click.
   */
  disabledFolderId?: string | null;

  /**
   * Whether to render the root / no-folder button at the top. Defaults to true.
   */
  showRootOption?: boolean;

  /**
   * Label for the root button (e.g. "Root (No Folder)", "Root (No Parent)").
   */
  rootLabel?: string;

  /**
   * Optional subtitle rendered under the root label. Ignored in compact mode.
   */
  rootDescription?: string;

  /**
   * Tighter spacing and smaller typography for use inside dense forms.
   */
  compact?: boolean;

  /**
   * When the picker mounts with a non-null `selectedFolderId`, fetch its
   * breadcrumbs and automatically expand all ancestor folders so the
   * selection is visible. Only fires for the initial selection — user
   * clicks do not trigger re-expansion. Defaults to `true`.
   */
  autoExpandToSelection?: boolean;

  className?: string;
}

/**
 * Recursive folder tree with expand/collapse and single-selection. Used as a
 * destination picker (MoveToFolderDialog) and a parent picker
 * (CreateFolderDialog).
 */
export function FolderTreePicker({
  selectedFolderId,
  onSelect,
  disabledFolderId = null,
  showRootOption = true,
  rootLabel = "Root (No Folder)",
  rootDescription,
  compact = false,
  autoExpandToSelection = true,
  className,
}: FolderTreePickerProps) {
  const { data: rootFolders, isLoading } = useRootFolders();
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  // Auto-expand: whenever a selection exists, fetch its breadcrumbs and make
  // sure every ancestor is in the expanded set so the selected row is
  // visible. Adds are idempotent (the Set dedupes), so clicking a folder
  // that's already visible is a no-op on expansion state.
  const { data: selectedFolderData } = useFolderById(
    autoExpandToSelection ? selectedFolderId : undefined
  );

  React.useEffect(() => {
    if (!selectedFolderData?.breadcrumbs) return;
    const ancestorIds = selectedFolderData.breadcrumbs
      .map(b => b.id)
      .filter(id => id !== "root" && id !== selectedFolderId);
    if (ancestorIds.length === 0) return;
    setExpandedIds(prev => {
      if (ancestorIds.every(id => prev.has(id))) return prev;
      const next = new Set(prev);
      ancestorIds.forEach(id => next.add(id));
      return next;
    });
  }, [selectedFolderData, selectedFolderId]);

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

  if (isLoading) {
    return (
      <div
        className={cn(
          "py-8 text-center text-sm text-muted-foreground",
          className
        )}
      >
        Loading folders...
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {showRootOption && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "group flex w-full items-center text-left transition-all duration-200",
            compact ? "gap-2 px-3 py-2" : "gap-3 px-4 py-3",
            selectedFolderId === null
              ? "bg-primary/5 text-primary"
              : "hover:bg-primary/5 hover:text-primary"
          )}
        >
          <FolderIcon
            className={cn(
              "shrink-0 transition-colors",
              selectedFolderId === null
                ? "text-primary"
                : "text-muted-foreground group-hover:text-primary",
              compact ? "h-4 w-4" : "h-5 w-5"
            )}
          />
          <div className="flex-1">
            <div
              className={cn(
                "font-medium tracking-tight text-[13px]",
                compact && "text-xs"
              )}
            >
              {rootLabel}
            </div>
            {!compact && rootDescription && (
              <div className="text-sm opacity-70">{rootDescription}</div>
            )}
          </div>
        </button>
      )}

      {rootFolders?.map(folder => (
        <FolderTreePickerItem
          key={folder.id}
          folder={folder}
          level={0}
          selectedFolderId={selectedFolderId}
          disabledFolderId={disabledFolderId}
          expandedIds={expandedIds}
          onToggle={toggleExpand}
          onSelect={onSelect}
          compact={compact}
        />
      ))}
    </div>
  );
}

interface FolderTreePickerItemProps {
  folder: MediaFolder;
  level: number;
  selectedFolderId: string | null;
  disabledFolderId: string | null;
  expandedIds: Set<string>;
  onToggle: (folderId: string) => void;
  onSelect: (folder: MediaFolder) => void;
  compact: boolean;
}

function FolderTreePickerItem({
  folder,
  level,
  selectedFolderId,
  disabledFolderId,
  expandedIds,
  onToggle,
  onSelect,
  compact,
}: FolderTreePickerItemProps) {
  const isExpanded = expandedIds.has(folder.id);
  const { data: subfolders } = useSubfolders(
    isExpanded ? folder.id : undefined
  );
  const isDisabled = folder.id === disabledFolderId;
  const isSelected = folder.id === selectedFolderId;

  const iconSize = compact ? "h-4 w-4" : "h-5 w-5";
  const chevronSize = compact ? "h-3 w-3" : "h-3.5 w-3.5";
  const indentPx = compact ? 8 + level * 16 : 16 + level * 20;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center transition-all duration-200",
          compact ? "gap-1.5 px-2 py-1.5" : "gap-2 px-3 py-2.5",
          isDisabled && "cursor-not-allowed opacity-50",
          isSelected
            ? "bg-primary/5 text-primary"
            : "hover:bg-primary/5 hover:text-primary"
        )}
        style={{ paddingLeft: `${indentPx}px` }}
      >
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onToggle(folder.id);
          }}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-sm transition-colors",
            isSelected
              ? "text-primary/70 hover:text-primary hover:bg-primary/10"
              : "text-muted-foreground group-hover:text-primary hover:bg-primary/10",
            compact ? "h-4 w-4" : "h-5 w-5"
          )}
        >
          {isExpanded ? (
            <ChevronDown className={chevronSize} />
          ) : (
            <ChevronRight className={chevronSize} />
          )}
        </button>

        <button
          type="button"
          onClick={() => !isDisabled && onSelect(folder)}
          disabled={isDisabled}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center transition-colors",
              isSelected
                ? "text-primary"
                : "text-muted-foreground group-hover:text-primary",
              iconSize
            )}
          >
            <FolderIcon className={iconSize} />
          </span>
          <span className="truncate text-xs font-medium tracking-tight">
            {folder.name}
          </span>
          {isDisabled && (
            <span className="shrink-0 text-xs text-muted-foreground">
              (Current)
            </span>
          )}
        </button>
      </div>

      {isExpanded && subfolders && subfolders.length > 0 && (
        <div className="mt-1 space-y-1">
          {subfolders.map(sub => (
            <FolderTreePickerItem
              key={sub.id}
              folder={sub}
              level={level + 1}
              selectedFolderId={selectedFolderId}
              disabledFolderId={disabledFolderId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
}
