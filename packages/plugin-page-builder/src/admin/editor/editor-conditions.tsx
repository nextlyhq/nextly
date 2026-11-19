"use client";

/**
 * The editor's conditions: what the canvas's condition badges judge with, the
 * strip above the canvas, and the author's "Preview as visitor", which
 * applies a document's conditions for the entry it is previewed with.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-conditions
 */
import type { BlockDocument, DocumentKind } from "@nextlyhq/blocks-engine";
import {
  useAppliedConditions,
  type AppliedConditions,
  type AppliedConditionsOptions,
} from "@nextlyhq/builder/shell";
import { useCallback, useEffect, useMemo, useState } from "react";

import { loopCollectionsIn } from "../loop-collections-client";

import type { useCanvasEntryIdentity } from "./canvas-entry";
import type { ConditionedPage } from "./conditioned-page";
import {
  VisitorStrip,
  visitorStripWords,
  visitorUnavailable,
} from "./conditions-strip";
import type { ContentServices } from "./editor-services";
import {
  usePageConditionsRead,
  type PageConditionsSource,
} from "./page-conditions-read";
import { focusPreviewMenu, type VisitorPreview } from "./preview-button";
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
 * The strip above the canvas: a template's Previewing strip, with the
 * visitor's row under it while "Preview as visitor" is on; on any other
 * document, the visitor's row alone while it is on, and none otherwise.
 */
export function editorStrip(
  preview: ReturnType<typeof useTemplatePreviewState>,
  conditions: AppliedConditionsSwitch,
  /** Notices about the page itself, drawn under the preview's rows. */
  notice?: React.JSX.Element
): React.JSX.Element | undefined {
  const strip = previewStrip(preview, conditions);
  if (notice === undefined) return strip;
  return strip === undefined ? (
    notice
  ) : (
    <>
      {strip}
      {notice}
    </>
  );
}

/** The template's Previewing row and the visitor's, where either shows. */
function previewStrip(
  preview: ReturnType<typeof useTemplatePreviewState>,
  conditions: AppliedConditionsSwitch
): React.JSX.Element | undefined {
  const visitor =
    conditions.said === undefined ? undefined : (
      <VisitorStrip
        said={conditions.said}
        onStop={() => {
          conditions.visitor.onChange(false);
          focusPreviewMenu();
        }}
      />
    );
  if (preview === undefined) return visitor;
  return visitor === undefined ? (
    <TemplatePreviewStrip preview={preview} />
  ) : (
    <TemplatePreviewStrip preview={preview} visitor={visitor} />
  );
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

/** "Preview as visitor", what it did, and the page as the canvas draws it. */
interface AppliedConditionsSwitch {
  /** "Preview as visitor", for the top bar's Preview menu. */
  readonly visitor: VisitorPreview;
  /**
   * What the visitor strip says the conditions did, while the canvas shows
   * the page as a visitor gets it; absent while it does not.
   */
  readonly said: string | undefined;
  /** The page with its conditions applied, while they are. */
  readonly applied: AppliedConditions | undefined;
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
 * What the conditions are checked against, and what it is called: on a
 * template, its previewed entry as the page settles on it (so a refresh of
 * that same entry keeps the subject they were judged by), named as the
 * collection names its entries; on a page, the page itself as a visitor
 * reads it, where it is an entry of a collection.
 */
function checkedSubject(
  preview: ReturnType<typeof useTemplatePreviewState>,
  entry: ConditionedPage["entry"],
  pageRead: ReturnType<typeof usePageConditionsRead>,
  pageSource: PageConditionsSource | undefined
): { readonly noun: string; readonly previewed: ConditionedPage["entry"] } {
  if (preview !== undefined) {
    return { noun: preview.labels.singular.toLowerCase(), previewed: entry };
  }
  return {
    noun: pageSource === undefined ? "entry" : pageRead.noun,
    previewed: pageRead.previewed,
  };
}

/**
 * The author's "Preview as visitor", which applies the conditions for the
 * entry a template is previewed with, or for the page itself, and the page
 * as they leave it. Applied only to the blocks that read the entry; checked
 * against the entry as a visitor reads it, so the canvas hides what the
 * published page would. The author's own, for this session: kept in this
 * editor's state and never stored.
 */
export function useAppliedConditionsSwitch(
  { entry, composed, held }: ConditionedPage,
  preview: ReturnType<typeof useTemplatePreviewState>,
  kind: DocumentKind,
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
  const onChange = useCallback((next: boolean) => {
    if (next) setAttempt(count => count + 1);
    setOn(next);
  }, []);
  // A document left with no conditioned block turns the view off, so one
  // added again later doesn't bring it back unasked. Judged only with the
  // entry in hand: between entries a template is drawn bare, without the
  // entry's own content and any conditions in it, which is no removal, so a
  // template switching entries keeps showing each as a visitor gets it.
  const entryInHand = preview === undefined || entry?.kind === "entry";
  useEffect(() => {
    if (!checks && entryInHand) setOn(false);
  }, [checks, entryInHand]);
  const unavailable = visitorUnavailable(
    kind,
    checks,
    preview !== undefined ? entry?.kind === "entry" : pageSource !== undefined
  );
  // Applied only while it is on and can be: a template between entries
  // shows every block until the next one is read.
  const active = on && unavailable === undefined;
  // A page is read as a visitor reads it, and only once the author applies
  // its conditions.
  const pageRead = usePageConditionsRead(
    pageSource,
    active && pageSource !== undefined,
    attempt
  );
  const { noun, previewed } = checkedSubject(
    preview,
    entry,
    pageRead,
    pageSource
  );
  // The entry is handed over only while it is on: the canvas then draws the
  // page as a visitor reading that entry would get it.
  const applied = useAppliedConditions(
    composed,
    active ? previewed : undefined,
    { ...options, noun }
  );
  const visitor = useMemo<VisitorPreview>(
    () => ({ on: active, onChange, unavailable }),
    [active, onChange, unavailable]
  );
  const said = active
    ? visitorStripWords({
        applied,
        noun,
        failed: preview === undefined && pageRead.failed,
      })
    : undefined;
  return { visitor, said, applied, noun, composed };
}
