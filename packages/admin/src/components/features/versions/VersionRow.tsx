/**
 * One entry in a document's version history.
 *
 * Shows only metadata: the list never carries snapshots, so a row describes a
 * version rather than containing it.
 *
 * @module components/features/versions/VersionRow
 */

import { Pencil } from "lucide-react";

import { formatRelativeTime } from "@admin/components/features/notifications/relative-time";
import { Badge } from "@admin/components/ui";
import { formatDateTime } from "@admin/lib/dates/format";
import { cn } from "@admin/lib/utils";
import type { VersionMeta } from "@admin/services/versionApi";

export interface VersionRowProps {
  version: VersionMeta;
  /** Highlighted because it is the version currently being previewed. */
  active?: boolean;
  onSelect: (versionNo: number) => void;
  /** Omitted when the caller cannot rename, which hides the affordance. */
  onRename?: (versionNo: number) => void;
}

export function VersionRow({
  version,
  active = false,
  onSelect,
  onRename,
}: VersionRowProps) {
  // A version with no number is an autosave and cannot be addressed on its own,
  // so it is shown but not offered as something to open — or to name.
  const selectable = typeof version.versionNo === "number";

  // What the row is called. `version.label` is the editor's own name for it;
  // the number is the fallback, and stays visible either way so two versions
  // sharing a name are still tellable apart.
  const ordinal = selectable ? `Version ${version.versionNo}` : "Autosave";
  const named = version.label !== null && version.label !== "";
  const title = named ? (version.label as string) : ordinal;

  // Attribution is absent for a system write rather than missing, so it reads
  // as "nobody signed this" instead of looking like a failed lookup.
  const author = version.author?.name ?? "Unknown author";

  const canRename = selectable && onRename !== undefined;

  return (
    // A row is not a single button: the rename control has to sit beside the
    // open control rather than inside it, or it would be a nested interactive
    // element — invalid, and unreachable in the tab order.
    <div
      className={cn(
        "relative flex items-stretch border-b border-border last:border-b-0",
        active && "bg-primary/5"
      )}
    >
      <button
        type="button"
        disabled={!selectable}
        onClick={() => selectable && onSelect(version.versionNo as number)}
        aria-label={`${title}, ${version.status}, by ${author}`}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex-1 min-w-0 text-left px-4 py-3",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          selectable ? "hover:bg-muted cursor-pointer" : "cursor-default"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {title}
          </span>
          {/* Once a version is named, its number still identifies it — for
              telling apart two versions an editor gave the same name. */}
          {named && selectable && (
            <span className="text-xs text-muted-foreground shrink-0">
              {ordinal}
            </span>
          )}
          <Badge variant="outline" className="shrink-0">
            {version.status}
          </Badge>
          <span
            className="ml-auto text-xs text-muted-foreground shrink-0"
            // The relative label is scannable; the exact time is what an editor
            // needs when deciding between two nearby versions.
            title={formatDateTime(version.createdAt)}
          >
            {formatRelativeTime(version.createdAt)}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground truncate">
          {author}
        </div>
      </button>

      {canRename && (
        <button
          type="button"
          onClick={() => onRename(version.versionNo as number)}
          aria-label={
            named ? `Rename ${title}` : `Name version ${version.versionNo}`
          }
          className={cn(
            "shrink-0 px-3 text-muted-foreground",
            "hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          )}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
