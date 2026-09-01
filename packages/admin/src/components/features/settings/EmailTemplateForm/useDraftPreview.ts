"use client";

/**
 * The server's render of the draft on screen.
 *
 * Split from `useDerivedTemplateState` because it answers a different question
 * and owns different machinery. That hook reads what has been TYPED — parsing
 * the sample JSON, naming variables that resolve to nothing — and all of it is
 * synchronous and local. This one owns a request: what to send, how often, and
 * what to show while the answer is in flight or refused.
 *
 * @module components/features/settings/EmailTemplateForm/useDraftPreview
 */
import { useMemo, useRef } from "react";

import { useDraftEmailTemplatePreview } from "@admin/hooks/queries/useEmailTemplates";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import type {
  DraftPreviewResult,
  DraftPreviewTemplate,
} from "@admin/services/emailTemplateApi";

/**
 * How long typing must pause before the draft is rendered again.
 *
 * Long enough that a word typed at speed is one render rather than six; short
 * enough that the pane still reads as live. Applied to the render inputs only:
 * switching device or format re-reads what is already cached.
 */
const PREVIEW_DEBOUNCE_MS = 300;

export interface DraftPreviewState {
  previewHtml: string;
  previewText: string;
  previewSubject: string;
  /** A render is in flight and there is no earlier one to show in its place. */
  isPreviewPending: boolean;
  /** The render was refused or unreachable; the pane says so rather than lying. */
  previewError: string | null;
}

export function useDraftPreview(
  draft: DraftPreviewTemplate,
  data: Record<string, unknown>,
  { enabled }: { enabled: boolean }
): DraftPreviewState {
  const debouncedDraft = useDebouncedValue(draft, PREVIEW_DEBOUNCE_MS);
  const debouncedData = useDebouncedValue(data, PREVIEW_DEBOUNCE_MS);

  const {
    data: preview,
    isPending,
    error,
  } = useDraftEmailTemplatePreview(debouncedDraft, debouncedData, { enabled });

  /*
   * The last render that SUCCEEDED, held across a failure.
   *
   * `keepPreviousData` does not survive one: it supplies placeholder data only
   * while a query is pending, so the moment an edited draft's request rejects
   * the status becomes `error` and `data` becomes undefined. Falling back to
   * empty strings there would blank the frame under the error banner — the
   * author loses the render they were reading BECAUSE something went wrong,
   * which is precisely when they need it. Written during render because it is
   * a cache of a value this render already has, and re-running it is a no-op.
   */
  const lastRendered = useRef<DraftPreviewResult | null>(null);
  if (preview !== undefined) lastRendered.current = preview;
  const shown = preview ?? lastRendered.current;

  return useMemo(
    () => ({
      previewHtml: shown?.html ?? "",
      previewText: shown?.text ?? "",
      previewSubject: shown?.subject ?? "",
      isPreviewPending: isPending && shown === null,
      previewError: error ? error.message : null,
    }),
    [shown, isPending, error]
  );
}
