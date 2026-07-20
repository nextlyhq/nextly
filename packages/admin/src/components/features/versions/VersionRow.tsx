/**
 * One entry in a document's version history.
 *
 * Shows only metadata: the list never carries snapshots, so a row describes a
 * version rather than containing it.
 *
 * @module components/features/versions/VersionRow
 */

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
}

export function VersionRow({
  version,
  active = false,
  onSelect,
}: VersionRowProps) {
  // A version with no number is an autosave and cannot be addressed on its own,
  // so it is shown but not offered as something to open.
  const selectable = typeof version.versionNo === "number";

  const label = selectable ? `Version ${version.versionNo}` : "Autosave";

  // Attribution is absent for a system write rather than missing, so it reads
  // as "nobody signed this" instead of looking like a failed lookup.
  const author = version.author?.name ?? "Unknown author";

  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={() => selectable && onSelect(version.versionNo as number)}
      aria-label={`${label}, ${version.status}, by ${author}`}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border last:border-b-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selectable ? "hover:bg-muted cursor-pointer" : "cursor-default",
        active && "bg-primary/5"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground truncate">
          {label}
        </span>
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
  );
}
