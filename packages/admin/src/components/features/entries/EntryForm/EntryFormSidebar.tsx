"use client";

import type { JSX } from "react";

import { useEntryDetails, type EntryDetailsTarget } from "./entry-details-read";
import { DocumentPanel, type DocumentPanelProps } from "./panels";

// What the document panel says, for both editors: its sections in order. The
// frame it is drawn in, docked, floating or a sheet, is `DocumentSidePanel`'s.

/**
 * The document panel's own props, so a section the panel learns to draw
 * reaches it through here without a second list of props to keep in step,
 * and whether it is drawn at all.
 */
export type EntryFormSidebarProps = Omit<
  DocumentPanelProps,
  "hasStatus" | "details"
> & {
  /**
   * The document whose details (who made and changed it) the panel shows.
   * Read only while the panel is drawn, so a panel its author folded, or a
   * document view covering the form, costs no request.
   */
  detailsOf?: EntryDetailsTarget;
  /** Whether sidebar should be hidden (embedded mode or rail collapsed). */
  hidden?: boolean;
  /** Whether this collection has Draft/Published status enabled, which the
   *  Status and Publishing sections and the language section read. */
  hasStatus?: boolean;
};

export function EntryFormSidebar({
  hidden = false,
  hasStatus = false,
  detailsOf,
  ...panel
}: EntryFormSidebarProps): JSX.Element | null {
  const details = useEntryDetails(hidden ? undefined : detailsOf);
  if (hidden) return null;

  return (
    <div className="flex flex-col bg-background">
      <DocumentPanel
        hasStatus={hasStatus}
        {...panel}
        {...(details === undefined ? {} : { details })}
      />
    </div>
  );
}
