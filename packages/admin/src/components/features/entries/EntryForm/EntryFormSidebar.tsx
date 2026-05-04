"use client";

import type { FieldConfig } from "@revnixhq/nextly/config";

import { EntryFormContent } from "./EntryFormContent";
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
  /** Slug field — system content rendered above DocumentPanel as a small
   *  inline editor. PR 6 of the redesign moves slug INTO DocumentPanel. */
  slugField?: FieldConfig;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryFormSidebar — system-content rail.
 *
 * Stack of named panels (Status, Document, Revisions, Activity) plus a
 * compact Slug surface for now. Per Q-D1=B in the redesign spec the rail
 * is system-content only: no user-defined fields render here.
 *
 * Action buttons MOVED OUT of the rail in PR 5 — they live in the new
 * top action bar (DocumentTabs sibling) implemented in EntryFormActions.
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

      {slugField && (
        <div className="px-5 py-4 border-b border-primary/5">
          <EntryFormContent fields={[slugField]} />
        </div>
      )}

      <DocumentPanel mode={mode} entry={entry} />
      <RevisionsPanel />
      <ActivityPanel />
    </div>
  );
}
