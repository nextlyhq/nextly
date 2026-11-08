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
import type {
  BlockDocument,
  DefinitionsById,
  DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  conditionedBlocksIn,
  useComposedEntryContent,
  type PreviewedEntry,
} from "@nextlyhq/builder/shell";
import { useMemo } from "react";

import { useSettledEntry, type TemplatePreview } from "./use-template-preview";

/** The page as drawn, and which of its blocks are conditioned. */
export interface ConditionedPage {
  /**
   * The entry the page is drawn and its conditions judged with
   * (`useSettledEntry`): the one named, or, while a refresh reads that same
   * entry again, the entry as last read; `undefined` outside a template.
   */
  readonly entry: PreviewedEntry | undefined;
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
 * blocks. Composed from the settled entry (`useSettledEntry`): while the
 * window's refresh reads the same entry again, the page keeps its blocks,
 * and their conditions, as they were, rather than drawing the bare template
 * and dropping their count until the reads are back; a switch to another
 * entry draws none of it until both its reads have answered, so its bound
 * values never draw as fallbacks first, and a failed read draws none.
 */
export function useConditionedPage(
  document: BlockDocument,
  preview: TemplatePreview | undefined,
  limits: DocumentLimits | undefined,
  /** The definitions of the components the page places, if any. */
  definitions?: DefinitionsById
): ConditionedPage {
  const entry = useSettledEntry(preview);
  const composed = useComposedEntryContent(document, entry, {
    ...limits,
    ...(definitions === undefined ? {} : { definitions }),
  });
  const held = useMemo(
    () => conditionedBlocksIn(composed, limits),
    [composed, limits]
  );
  return { entry, composed, held };
}
