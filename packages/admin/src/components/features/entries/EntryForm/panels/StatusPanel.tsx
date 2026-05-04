"use client";

import type React from "react";

import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { cn } from "@admin/lib/utils";

import type { EntryData } from "../useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface StatusPanelProps {
  /** Entry data with timestamps and optional status. */
  entry?: EntryData | null;
  /** Whether the parent collection has draft/published status enabled.
   *  When false, the panel hides — the redesign spec hides the entire status
   *  surface (action bar pill + this panel) for collections that don't opt in. */
  hasStatus: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Top rail panel: shows the entry's draft/published status as a pill plus
 * a "Edited Nm ago" line. Hidden entirely when `hasStatus` is false.
 */
export function StatusPanel({
  entry,
  hasStatus,
}: StatusPanelProps): React.ReactElement | null {
  const { formatDate } = useAdminDateFormatter();

  if (!hasStatus) return null;

  const status = (entry?.status as string | undefined) ?? "draft";
  const updatedAt =
    entry?.updatedAt ?? (entry?.updated_at as string | undefined) ?? undefined;

  return (
    <div className="px-5 py-4 border-b border-primary/5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground">
          Status
        </p>
        <StatusPill status={status} />
      </div>
      {updatedAt && (
        <p className="text-xs text-muted-foreground">
          Edited{" "}
          {formatDate(
            updatedAt,
            { dateStyle: "medium", timeStyle: "short" },
            updatedAt
          )}
        </p>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isPublished = status === "published";
  return (
    <span
      className={cn(
        "px-2 py-1 text-[10px] font-bold tracking-[0.1em] uppercase rounded",
        isPublished
          ? "bg-green-50 text-green-800"
          : "bg-amber-50 text-amber-800"
      )}
    >
      {isPublished ? "Published" : "Draft"}
    </span>
  );
}
