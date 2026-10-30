"use client";

import type { JSX } from "react";

import { cn } from "@admin/lib/utils";

import { DOCUMENT_COLUMN_INSET } from "./DocumentEditorLayout";
import { DocumentIdCopy } from "./DocumentIdCopy";

// Why: the document's id, offered to copy on a quiet line under the title
// wherever the Document panel is not on screen. The status and the slug that
// once shared this strip now live in the document bar and under the title.

export interface EntryMetaStripProps {
  /**
   * Whether the docked document panel is on screen beside the fields. It
   * carries the id itself there, so this line steps aside; wherever the panel
   * is folded, floats or is a sheet, it opens only when asked for, and this
   * line is where the id is offered.
   */
  panelCarriesId: boolean;
  /** The document's id. Absent before the document exists, and then no line
   *  is drawn. */
  documentId?: string | null | undefined;
}

export function EntryMetaStrip({
  panelCarriesId,
  documentId,
}: EntryMetaStripProps): JSX.Element | null {
  if (!documentId || panelCarriesId) return null;

  return (
    <div
      className={cn(
        "mt-1.5 flex items-center gap-1 text-xs text-muted-foreground",
        DOCUMENT_COLUMN_INSET
      )}
    >
      <span>ID:</span>
      <DocumentIdCopy id={documentId} />
    </div>
  );
}
