"use client";

/**
 * The editor's conditions: what the canvas's condition badges judge with, the
 * strip above the canvas, and the author's switch that applies a document's
 * conditions for the entry it is previewed with.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-conditions
 */
import type { BlockDocument, DocumentKind } from "@nextlyhq/blocks-engine";
import {
  useAppliedConditions,
  type AppliedConditions,
  type AppliedConditionsOptions,
} from "@nextlyhq/builder/shell";
import { useCallback, useMemo, useState } from "react";

import { loopCollectionsIn } from "../loop-collections-client";

import type { useCanvasEntryIdentity } from "./canvas-entry";
import type { ConditionedPage } from "./conditioned-page";
import {
  PageConditionsStrip,
  PlacedConditionsStrip,
  type TemplateConditions,
} from "./conditions-strip";
import type { ContentServices } from "./editor-services";
import {
  usePageConditionsRead,
  type PageConditionsSource,
} from "./page-conditions-read";
import {
  TemplatePreviewStrip,
  type useTemplatePreviewState,
} from "./template-preview-strip";

/**
 * What the canvas's condition badges judge with: the inspector's own read of
 * the collections (so both share one read of the list), and the collection
 * the document's entry is of, where it has one. One object per language,
 * person and collection.
 */
export function useConditionServices(
  locale: string | undefined,
  userId: string | null,
  entryCollection: string | null | undefined
): {
  listLoopCollections: NonNullable<ContentServices["listLoopCollections"]>;
  entryCollection?: string | null;
} {
  return useMemo(
    () => ({
      listLoopCollections: loopCollectionsIn(locale, userId),
      ...(entryCollection === undefined ? {} : { entryCollection }),
    }),
    [locale, userId, entryCollection]
  );
}

/**
 * The strip above the canvas: a template's Previewing strip, with the switch
 * that applies its conditions while it holds a block whose conditions read
 * the entry; a page's own strip, with the switch and no entry to name, while
 * it holds a block whose conditions read the page; a component's own strip,
 * with the switch disabled, while it holds a conditioned block; none
 * otherwise.
 */
export function editorStrip(
  preview: ReturnType<typeof useTemplatePreviewState>,
  conditions: AppliedConditionsSwitch,
  kind: DocumentKind,
  title: string | undefined
): React.JSX.Element | undefined {
  if (conditions.page !== undefined) {
    return <PageConditionsStrip conditions={conditions.page} />;
  }
  if (preview !== undefined) {
    return conditions.template === undefined ? (
      <TemplatePreviewStrip preview={preview} />
    ) : (
      <TemplatePreviewStrip
        preview={preview}
        conditions={conditions.template}
      />
    );
  }
  // Only a component is placed elsewhere and edited on its own: a Layout's
  // header and footer are components too, so they get this same strip.
  if (!conditions.held || kind !== "component") {
    return undefined;
  }
  return <PlacedConditionsStrip kind="Component" name={title ?? "Component"} />;
}

/**
 * The page whose own conditions read it, on a page that is not a template:
 * the entry of a collection being edited, read as a visitor reads it. None on
 * a template, whose conditions read the entry it is previewed with, on a
 * component or a Layout, which has no entry, or on a Single, which is not an
 * entry of a collection. The editor opens only a saved entry, so one with no
 * id is never asked about.
 */
export function pageConditionsSourceOf(
  preview: ReturnType<typeof useTemplatePreviewState>,
  kind: DocumentKind,
  identity: ReturnType<typeof useCanvasEntryIdentity>,
  locale: string | undefined
): PageConditionsSource | undefined {
  if (preview !== undefined || kind !== "page") return undefined;
  if (identity?.kind !== "collection" || identity.documentId === undefined) {
    return undefined;
  }
  return { collection: identity.slug, id: identity.documentId, locale };
}

/** The switch that applies a document's conditions, and what it did. */
interface AppliedConditionsSwitch {
  /** The switch's state in a template's strip; absent outside a template. */
  readonly template: TemplateConditions | undefined;
  /** The switch's state in a page's strip; absent outside a page. */
  readonly page: TemplateConditions | undefined;
  /** The page with its conditions applied, while they are. */
  readonly applied: AppliedConditions | undefined;
  /** Whether the document holds a conditioned block at all. */
  readonly held: boolean;
  /** What the previewed entry is called in words, lower case: "post". */
  readonly noun: string;
  /**
   * The document as the canvas draws it: a template's with the previewed
   * entry's own blocks composed into its Entry content, which the conditions
   * are judged on and the canvas draws, composing nothing of its own.
   */
  readonly composed: BlockDocument;
}

/**
 * The author's switch that applies the conditions for the entry a template
 * is previewed with, and the page as they leave it. Applied only to the
 * blocks that read the entry; checked against the entry as a visitor reads
 * it, so the canvas hides what the published page would.
 */
export function useAppliedConditionsSwitch(
  { entry, composed, held }: ConditionedPage,
  preview: ReturnType<typeof useTemplatePreviewState>,
  pageSource: PageConditionsSource | undefined,
  options: Omit<AppliedConditionsOptions, "noun">
): AppliedConditionsSwitch {
  const [on, setOn] = useState(false);
  // Something to check: a block reading the entry, or one a list's entry
  // decides, checked for each entry the list draws.
  const checks = held.readingEntry || held.readingItems;
  // Each time the conditions are applied, counted, so a failed read of the
  // page is asked again rather than kept.
  const [attempt, setAttempt] = useState(0);
  const toggle = useCallback(() => {
    if (!on) setAttempt(count => count + 1);
    setOn(!on);
  }, [on]);
  // A page is read as a visitor reads it, and only once the author applies
  // its conditions.
  const pageRead = usePageConditionsRead(
    pageSource,
    on && checks && pageSource !== undefined,
    attempt
  );
  const noun =
    preview !== undefined
      ? preview.labels.singular.toLowerCase()
      : pageSource !== undefined
        ? pageRead.noun
        : "entry";
  // A template's entry as the page settles on it, so a refresh of that same
  // entry keeps the subject its conditions were judged by.
  const previewed = preview !== undefined ? entry : pageRead.previewed;
  // The entry is handed over only while the switch is on: the canvas then
  // draws the page as a visitor reading that entry would get it.
  const applied = useAppliedConditions(
    composed,
    on && checks ? previewed : undefined,
    { ...options, noun }
  );
  const template = useMemo<TemplateConditions | undefined>(
    () =>
      preview === undefined || !checks
        ? undefined
        : {
            on,
            toggle,
            available: previewed?.kind === "entry",
            applied,
            noun,
          },
    [preview, checks, on, toggle, previewed, applied, noun]
  );
  const page = useMemo<TemplateConditions | undefined>(
    () =>
      pageSource === undefined || !checks
        ? undefined
        : // The editor opens only a saved page, so there is always one to read.
          {
            on,
            toggle,
            available: true,
            applied,
            noun,
            failed: pageRead.failed,
          },
    [pageSource, checks, on, toggle, applied, noun, pageRead.failed]
  );
  return { template, page, applied, held: held.any, noun, composed };
}
