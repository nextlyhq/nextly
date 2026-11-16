"use client";

/**
 * Preview, in the editor's top bar.
 *
 * The admin's own Preview for this document, the one its header would offer,
 * in the language being edited. Drawn only where the admin offers one, so the
 * bar never holds a button that opens nothing. An eye and the word, as the
 * header's own Preview: an icon alone is a guess at what it opens. On a
 * narrow bar the word steps aside, its tooltip and name staying.
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
import { Button } from "@nextlyhq/ui";
import { Eye } from "lucide-react";
import type * as React from "react";

export function PreviewButton(): React.JSX.Element | null {
  const preview = useDocumentPreview();
  const saving = useDocumentActions()?.saveState.kind === "saving";
  if (preview === null) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      title="Preview"
      disabled={saving}
      onClick={() => {
        void preview.open();
      }}
    >
      <Eye className="size-4" aria-hidden="true" />
      {/* The word gives way on a bar narrower than 1400px, as the device
          labels do, and stays the button's name for a screen reader. */}
      <span className="@max-[1400px]/topbar:sr-only">Preview</span>
    </Button>
  );
}
