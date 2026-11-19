"use client";

/**
 * Each language's stage in the workflow that holds a document's publishing,
 * by language code, with the shape of its kind, for the Languages panel to
 * say beside each status. Read from the review state every other surface
 * reads, so it costs no request of its own. Undefined where no workflow is
 * attached, or before the document exists.
 *
 * @module components/features/entries/review/useLanguageReviewStages
 */

import { useReviewState } from "@admin/hooks/queries/useReviewState";
import type { ReleaseDocumentRef } from "@admin/types/releases";

import { stageShapeOf, type StageShapeKind } from "./StageShape";

/** A language's stage: its words, and the shape of its kind, which the panel draws beside them. */
export interface LanguageReviewStage {
  label: string;
  shape: StageShapeKind;
}

export function useLanguageReviewStages(
  document: ReleaseDocumentRef | undefined
): Readonly<Record<string, LanguageReviewStage>> | undefined {
  const { data } = useReviewState(document);
  if (data === undefined || !data.attached) return undefined;
  const stages: Record<string, LanguageReviewStage> = {};
  for (const part of data.review.parts) {
    const shape = stageShapeOf(part);
    if (part.part === null || part.stage === null || shape === null) continue;
    stages[part.part] = { label: part.stageLabel ?? part.stage, shape };
  }
  return stages;
}
