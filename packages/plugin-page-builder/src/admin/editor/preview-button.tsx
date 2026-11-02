"use client";

/**
 * Preview, in the editor's top bar.
 *
 * The admin's own Preview for this document, the one its header would offer,
 * in the language being edited. Drawn only where the admin offers one, so the
 * bar never holds a button that opens nothing. Icon-only, named for screen
 * readers and in its tooltip: the top bar has to fit at the editor's narrowest
 * width.
 *
 * Unavailable while the document is being saved, as the admin's own Preview
 * is: a preview minted mid-save could show the revision before the save.
 *
 * @module admin/editor/preview-button
 */
import {
  useDocumentActions,
  useDocumentPreview,
} from "@nextlyhq/plugin-sdk/admin";
import { Eye } from "lucide-react";
import type * as React from "react";

export function PreviewButton(): React.JSX.Element | null {
  const preview = useDocumentPreview();
  const saving = useDocumentActions()?.saveState.kind === "saving";
  if (preview === null) return null;
  return (
    <button
      type="button"
      aria-label="Preview"
      title="Preview"
      disabled={saving}
      onClick={() => {
        void preview.open();
      }}
      className="focus-visible:ring-ring rounded-md p-1.5 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
    >
      <Eye className="size-4" aria-hidden="true" />
    </button>
  );
}
