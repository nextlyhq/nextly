"use client";

/**
 * The review of one out-of-date field: what its source was and is, read once
 * it is asked for, and keeping the translation as it is.
 *
 * @module components/features/translations/review/useSourceReview
 */

import { useMutation, useQuery } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import {
  fetchSourceChange,
  keepTranslation,
  type SourceChange,
  type TranslatedFieldRef,
} from "@admin/services/sourceReviewApi";

export interface SourceReviewInput extends TranslatedFieldRef {
  /** The field's label, for what is said of it. */
  fieldLabel: string;
  /** Whether the review is open: nothing is read before. */
  open: boolean;
  /** The translation was kept: the page reads the document again. */
  onKept: () => Promise<unknown>;
}

export interface SourceReview {
  change: SourceChange | undefined;
  error: Error | null;
  retry: () => void;
  /** Absent where the server named nothing to keep against. */
  keep: (() => void) | undefined;
  isKeeping: boolean;
}

/** What to keep against, where the read named both. */
function shownIn(change: SourceChange | undefined) {
  const { valueFingerprint, sourceFingerprint } = change ?? {};
  return valueFingerprint === undefined || sourceFingerprint === undefined
    ? undefined
    : { valueFingerprint, sourceFingerprint };
}

export function useSourceReview({
  document,
  locale,
  field,
  fieldLabel,
  open,
  onKept,
}: SourceReviewInput): SourceReview {
  const read = useQuery({
    queryKey: [
      "translation-source-change",
      document.kind,
      document.slug,
      document.kind === "collection" ? document.id : "",
      locale,
      field,
    ],
    queryFn: () => fetchSourceChange({ document, locale, field }),
    enabled: open,
    // Read again each time it is opened: a source changes while a page is open.
    staleTime: 0,
    gcTime: 0,
  });
  const shown = shownIn(read.data);
  const keeping = useMutation({
    mutationFn: async (kept: NonNullable<typeof shown>) => {
      await keepTranslation({ document, locale, field }, kept);
    },
    onSuccess: async () => {
      toast.success(`${fieldLabel} kept as it is.`);
      await onKept();
    },
    onError: error => {
      toast.error(apiErrorMessage(error, `${fieldLabel} couldn't be kept.`));
      // What it was refused over has moved: shown as it is now.
      void read.refetch();
    },
  });
  return {
    change: read.data,
    error: read.data === undefined ? read.error : null,
    retry: () => void read.refetch(),
    keep: shown === undefined ? undefined : () => keeping.mutate(shown),
    isKeeping: keeping.isPending,
  };
}
