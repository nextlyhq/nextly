"use client";

import type { JSX } from "react";

import { cn } from "@admin/lib/utils";

import { DOCUMENT_COLUMN_INSET } from "./DocumentEditorLayout";
import { DocumentIdCopy } from "./DocumentIdCopy";

// Why: the document's id, offered to copy on a quiet line under the title
// wherever the Document panel is not on screen. The status and the slug that
// once shared this strip now live in the document bar and under the title.

export interface EntryMetaStripProps {
  /** Whether the panel is currently collapsed. Where it is expanded and on
   *  screen, it carries the id itself, so this line steps aside there. */
  isRailCollapsed: boolean;
  /** The document's id. Absent before the document exists, and then no line
   *  is drawn. */
  documentId?: string | null | undefined;
}

export function EntryMetaStrip({
  isRailCollapsed,
  documentId,
}: EntryMetaStripProps): JSX.Element | null {
  if (!documentId) return null;

  /*
   * The id says itself in the document panel where that panel is on screen and
   * open, so the line steps aside there and only there: at the width the panel
   * appears from (`@4xl/content`), while it is expanded. Below that width the
   * panel is not drawn at all, so this line is the only place the id is
   * offered, whatever the panel's setting.
   */
  const besidePanel = isRailCollapsed ? undefined : "@4xl/content:hidden";

  return (
    <div
      className={cn(
        "mt-1.5 flex items-center gap-1 text-xs text-muted-foreground",
        DOCUMENT_COLUMN_INSET,
        besidePanel
      )}
    >
      <span>ID:</span>
      <DocumentIdCopy id={documentId} />
    </div>
  );
}
