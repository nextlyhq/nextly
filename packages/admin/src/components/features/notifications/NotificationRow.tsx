"use client";

/**
 * F10 PR 5 — single row in the notification dropdown.
 *
 * Three rendered states:
 *   - success: green check + summary string + duration
 *   - failed:  red X + error code + clickable to expand the full
 *              error message inline
 *   - in_progress: yellow clock + "Started <relative>"
 *
 * Click-to-expand is local component state; no parent prop drilling.
 *
 * @module components/features/notifications/NotificationRow
 */

import { useState } from "react";

import { cn } from "@admin/lib/utils";
import type { JournalRow } from "@admin/services/journalApi";

import { formatJournalScope, formatJournalSummary } from "./formatters";
import { formatRelativeTime } from "./relative-time";

export interface NotificationRowProps {
  row: JournalRow;
}

export function NotificationRow({ row }: NotificationRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const failed = row.status === "failed";
  const inProgress = row.status === "in_progress";
  const expandable = failed && row.errorMessage !== null;

  return (
    <div
      data-testid="notification-row"
      data-status={row.status}
      className={cn(
        "border-b border-border last:border-b-0 px-4 py-3",
        expandable && "cursor-pointer hover:bg-muted/50"
      )}
      role={expandable ? "button" : undefined}
      tabIndex={expandable ? 0 : undefined}
      // a11y: announce the disclosure state so screen readers can tell
      // the user whether the inline error pre is currently expanded.
      aria-expanded={expandable ? expanded : undefined}
      onClick={expandable ? () => setExpanded(v => !v) : undefined}
      onKeyDown={
        expandable
          ? e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setExpanded(v => !v);
              }
            }
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        <StatusIcon status={row.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-sm truncate">
              {formatJournalScope(row.scope)}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatRelativeTime(row.startedAt)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {failed ? (
              <span className="text-destructive">
                {row.errorCode ?? "Failed"}
                {row.errorMessage ? " · click to expand" : ""}
              </span>
            ) : inProgress ? (
              <span>In progress…</span>
            ) : (
              <>
                {formatJournalSummary(row.summary)}
                {row.durationMs !== null ? ` · ${row.durationMs}ms` : ""}
              </>
            )}
          </div>
          {expanded && row.errorMessage && (
            <pre
              data-testid="notification-row-error-detail"
              className="mt-2 text-xs whitespace-pre-wrap break-words text-destructive bg-destructive/5 rounded p-2"
            >
              {row.errorMessage}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: JournalRow["status"] }): JSX.Element {
  if (status === "success") {
    // ASCII-only marks keep the test/snapshot stable across icon-pack
    // upgrades; replace with a lucide-react Check if visual polish
    // becomes a blocker.
    return (
      <span className="text-green-600 font-mono text-base leading-5">✓</span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-destructive font-mono text-base leading-5">✗</span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="text-yellow-600 font-mono text-base leading-5">⏳</span>
    );
  }
  // aborted (rare)
  return (
    <span className="text-muted-foreground font-mono text-base leading-5">
      ·
    </span>
  );
}
