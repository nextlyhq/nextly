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
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [previewId, setPreviewId] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const request = useCallback((next: SchemaPreviewResponse) => {
    setPreview(next);
    setPreviewId(n => n + 1);
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

  // The flag lives on `window`, so leaving it set outlives the page that set
  // it: navigating away mid-apply would leave every later schema change in
  // this tab looking like our own, and the announcement suppressed for good.
  // Unmounting ends this page's apply whether or not the request settled.
  useEffect(() => () => setApplyingFlag(false), []);

  return useMemo(
    () => ({
      preview,
      previewId,
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
      previewId,
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
