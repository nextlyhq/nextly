"use client";

import type { JSX } from "react";

import { DocumentPanel, type DocumentPanelProps } from "./panels";

// What the document panel says, for both editors: its sections in order. The
// frame it is drawn in, docked, floating or a sheet, is `DocumentSidePanel`'s.

/**
 * The document panel's own props, so a section the panel learns to draw
 * reaches it through here without a second list of props to keep in step,
 * and whether it is drawn at all.
 */
export type EntryFormSidebarProps = Omit<DocumentPanelProps, "hasStatus"> & {
  /** Whether sidebar should be hidden (embedded mode or rail collapsed). */
  hidden?: boolean;
  /** Whether this collection has Draft/Published status enabled, which the
   *  Status and Publishing sections and the language section read. */
  hasStatus?: boolean;
};

export function EntryFormSidebar({
  hidden = false,
  hasStatus = false,
  ...panel
}: EntryFormSidebarProps): JSX.Element | null {
  if (hidden) return null;

  return (
    <div className="flex flex-col bg-background">
      <DocumentPanel hasStatus={hasStatus} {...panel} />
    </div>
  );
}
