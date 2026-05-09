"use client";

import { DocumentPanel } from "./panels";
import type { EntryFormMode, EntryData } from "./useEntryForm";

// into DocumentPanel as a Status row; RevisionsPanel and ActivityPanel were
// "Coming soon" placeholders and removed entirely until those features ship
// with their own real surfaces.

export interface EntryFormSidebarProps {
  /** Form mode — DocumentPanel hides ID/Created/Updated/Status in create
   *  mode since the entry doesn't exist yet. */
  mode: EntryFormMode;
  /** Entry data — DocumentPanel reads id/status/timestamps. */
  entry?: EntryData | null;
  /** Whether sidebar should be hidden (embedded mode or rail collapsed). */
  hidden?: boolean;
  /** Whether this collection has Draft/Published status enabled. Drives
   *  whether the Status row renders inside DocumentPanel. */
  hasStatus?: boolean;
  /** Whether the form has unsaved local changes. Forwarded to DocumentPanel
   *  so it can render the "Modified" pill state on a dirty published entry. */
  isDirty?: boolean;
}

export function EntryFormSidebar({
  mode,
  entry,
  hidden = false,
  hasStatus = false,
  isDirty = false,
}: EntryFormSidebarProps) {
  if (hidden) return null;

  return (
    <div className="h-full flex flex-col bg-background overflow-y-auto">
      <DocumentPanel
        mode={mode}
        entry={entry}
        hasStatus={hasStatus}
        isDirty={isDirty}
      />
    </div>
  );
}
