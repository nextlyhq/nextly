"use client";

import type { FieldConfig } from "@revnixhq/nextly/config";

import {
  ActivityPanel,
  DocumentPanel,
  RevisionsPanel,
  StatusPanel,
} from "./panels";
import type { EntryFormMode, EntryData } from "./useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormSidebarProps {
  /** Form mode - 'create' or 'edit' */
  mode: EntryFormMode;
  /** Entry data with timestamps */
  entry?: EntryData | null;
  /** Whether sidebar should be hidden (embedded mode or rail collapsed) */
  hidden?: boolean;
  /** Whether this collection has Draft/Published status enabled. Drives
   *  whether the StatusPanel renders. */
  hasStatus?: boolean;
  /** Slug field — threaded into DocumentPanel as the first row with inline
   *  edit (Q-D5=iv). When the collection has no slug field this stays
   *  undefined and the slug row is omitted. */
  slugField?: FieldConfig;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryFormSidebar — system-content rail.
 *
 * Stack of named panels (Status, Document, Revisions, Activity). Per Q-D1=B
 * in the redesign spec the rail is system-content only; user fields never
 * render here.
 */
export function EntryFormSidebar({
  mode,
  entry,
  hidden = false,
  hasStatus = false,
  slugField,
}: EntryFormSidebarProps) {
  if (hidden) return null;

  return (
    <div className="h-full flex flex-col bg-background overflow-y-auto">
      <StatusPanel entry={entry} hasStatus={hasStatus} />
      <DocumentPanel mode={mode} entry={entry} slugField={slugField} />
      <RevisionsPanel />
      <ActivityPanel />
    </div>
  );
}
