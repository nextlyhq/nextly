"use client";

/**
 * useSchemaChangeConfirmation — the step between previewing a schema change and
 * applying it.
 *
 * A builder page previews its change, hands the result here, and renders
 * `BuilderSchemaChangeDialogs` against what this holds. Which of the two
 * dialogs the user sees is derived from the preview rather than decided again
 * by the page, so the page no longer restates the classification the dialogs
 * already make.
 */
import { useCallback, useMemo, useState } from "react";

import type { SchemaChangeConfirmation } from "@admin/components/features/schema-builder/types";
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";

/**
 * Tell the fetcher that this tab is the one changing the schema.
 *
 * It watches the `X-Nextly-Schema-Version` header and announces a schema
 * change it did not expect; without this flag, our own apply looks exactly
 * like a code-first edit or another tab and the page reacts to itself.
 */
function setApplyingFlag(applying: boolean): void {
  if (typeof window === "undefined") return;
  window.__nextlySchemaApplying = applying;
}

export function useSchemaChangeConfirmation(): SchemaChangeConfirmation {
  const [preview, setPreview] = useState<SchemaPreviewResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const request = useCallback((next: SchemaPreviewResponse) => {
    setPreview(next);
    setIsOpen(true);
  }, []);

  const setOpen = useCallback((open: boolean) => setIsOpen(open), []);

  // The preview is dropped along with the dialog: it described a schema that
  // has now changed, so a retry has to preview again rather than re-confirm
  // this one.
  const settle = useCallback(() => {
    setIsOpen(false);
    setPreview(null);
  }, []);

  const beginApply = useCallback(() => {
    setIsApplying(true);
    setApplyingFlag(true);
  }, []);

  const endApply = useCallback(() => {
    setIsApplying(false);
    setApplyingFlag(false);
  }, []);

  return useMemo(
    () => ({
      preview,
      isOpen,
      isApplying,
      request,
      setOpen,
      settle,
      beginApply,
      endApply,
    }),
    [
      preview,
      isOpen,
      isApplying,
      request,
      setOpen,
      settle,
      beginApply,
      endApply,
    ]
  );
}
