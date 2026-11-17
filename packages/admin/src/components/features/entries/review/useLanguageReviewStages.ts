"use client";

/**
 * Each language's stage in the workflow that holds a document's publishing,
 * by language code, for the Languages panel to say beside each status. Read
 * from the review state every other surface reads, so it costs no request of
 * its own. Undefined where no workflow is attached, or before the document
 * exists.
 *
 * @module components/features/entries/review/useLanguageReviewStages
 */

import { useReviewState } from "@admin/hooks/queries/useReviewState";
import type { ReleaseDocumentRef } from "@admin/types/releases";

export function useLanguageReviewStages(
  document: ReleaseDocumentRef | undefined
): Readonly<Record<string, string>> | undefined {
  const { data } = useReviewState(document);
  if (data === undefined || !data.attached) return undefined;
  const stages: Record<string, string> = {};
  for (const part of data.review.parts) {
    if (part.part === null || part.stage === null) continue;
    stages[part.part] = part.stageLabel ?? part.stage;
  }
  return stages;
}
