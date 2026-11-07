"use client";

/**
 * The page as the editor's canvas draws it, and which of its blocks carry
 * visibility conditions: a template's with the previewed entry's own blocks
 * composed into its Entry content, so the entry's conditioned blocks are
 * badged, judged and counted with the template's, and the switch that
 * applies conditions is offered where only they are conditioned. The one
 * composition the canvas draws.
 *
 * @module conditioned-page
 */
import type { BlockDocument, DocumentLimits } from "@nextlyhq/blocks-engine";
import {
  conditionedBlocksIn,
  useComposedEntryContent,
} from "@nextlyhq/builder/shell";
import { useMemo } from "react";

import type { TemplatePreview } from "./use-template-preview";

/** The page as drawn, and which of its blocks are conditioned. */
export interface ConditionedPage {
  /**
   * The page as the canvas draws it: a template's with the previewed entry's
   * own blocks composed into its Entry content; any other document as it is.
   */
  readonly composed: BlockDocument;
  /** Whether it holds a conditioned block, and one that reads the entry. */
  readonly held: ReturnType<typeof conditionedBlocksIn>;
}

/**
 * `document` as the canvas draws it, under `limits`, and its conditioned
 * blocks. Composed from the entry as its latest read has it (`latest`), never
 * only once a refresh has answered: while the window's refresh reads the
 * entry again, the page keeps the entry's blocks, and their conditions, as
 * they were, rather than drawing the bare template and dropping their count
 * until the read is back.
 */
export function useConditionedPage(
  document: BlockDocument,
  preview: TemplatePreview | undefined,
  limits: DocumentLimits | undefined
): ConditionedPage {
  const composed = useComposedEntryContent(document, preview?.latest, limits);
  const held = useMemo(
    () => conditionedBlocksIn(composed, limits),
    [composed, limits]
  );
  return { composed, held };
}
