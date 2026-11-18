"use client";
/**
 * What Page checks knows of the open page beyond its document, from what the
 * editor already reads and counts: the bindings "Bindings to fix" names on
 * this canvas, the page's data count the top bar's meter shows, the parts
 * the publish question would offer, and a header or footer the two-headers
 * notice points out. Each is the same answer its own surface gives, handed
 * to the builder's checks as a fact, so no question is asked twice.
 *
 * @module admin/editor/page-check-facts
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type {
  BindingToFix,
  DoubledRegionFact,
  PageDataFact,
  PageFacts,
  UnpublishedPart,
} from "@nextlyhq/builder";
import { useDocumentActions } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useRef, useState } from "react";

import type { LayoutArea } from "../../collections/areas";
import { usePageBindingsToFix } from "../bindings-report/page-rows";
import { changeSentence, whereBound } from "../bindings-report/words";
import { askReadiness } from "../publish-offer";

import type { PageDataCount } from "./page-read-meter";
import {
  pageAsDrawn,
  regionsShownTwice,
  twoRegionsWords,
  type DrawnRegionFacts,
} from "./two-regions-notice";
import { usePaused } from "./use-paused";

/** How long editing pauses before the publish question is asked again. */
const ASK_AFTER_PAUSE_MS = 1000;

/** What the facts are read from. */
export interface PageCheckFactsInputs {
  /** The field the editor is open on, which the bindings are read in. */
  readonly field: string;
  /** The page's own document, never a header edited in place. */
  readonly document: BlockDocument;
  /** The page with its conditions applied, while "Preview as visitor" is on. */
  readonly applied: { readonly document: BlockDocument } | undefined;
  /** The header and footer sets drawn around the page. */
  readonly regionCards: readonly DrawnRegionFacts[];
  readonly areaOf: (componentId: string) => LayoutArea | undefined;
  /** The page being edited, or null for any other document. */
  readonly currentPage: { readonly id: string } | null;
  /** The page's data count; null where the document has none. */
  readonly pageData: PageDataCount | null;
  /** The Layout the page names, as the publish question asks about it. */
  readonly layout: {
    readonly layout: string | null;
    readonly siteDefault: boolean;
  };
}

/** The page's data count as a fact: counted, still counting, or failed. */
export function pageDataFact(
  count: PageDataCount | null
): PageDataFact | undefined {
  if (count === null) return undefined;
  if (count.report !== undefined) {
    return { state: "counted", report: count.report };
  }
  return count.retry === undefined
    ? { state: "counting" }
    : { state: "failed" };
}

/** The bindings on this canvas, in the chip's words. */
function useBindingFacts(field: string): readonly BindingToFix[] | undefined {
  const { item, rows } = usePageBindingsToFix(field);
  return useMemo(
    () =>
      item === undefined
        ? undefined
        : rows.map(row => ({
            nodeId: row.nodeId,
            prop: row.prop,
            where: whereBound(row),
            change: changeSentence(row, item.collectionLabel),
          })),
    [item, rows]
  );
}

/**
 * The parts the page uses that aren't live, as the publish question asks
 * about them: asked when the page opens, after each save, and after each
 * pause in editing. None known while it could not be asked.
 */
function useUnpublishedParts(
  document: BlockDocument,
  { layout, siteDefault }: PageCheckFactsInputs["layout"],
  asks: boolean
): readonly UnpublishedPart[] | undefined {
  const storedAt = useDocumentActions()?.storedAt ?? null;
  const edited = usePaused(document, ASK_AFTER_PAUSE_MS);
  const [parts, setParts] = useState<readonly UnpublishedPart[] | undefined>();
  // The page as it stands when asked, without asking on every keystroke.
  const latest = useRef(document);
  latest.current = document;
  useEffect(() => {
    if (!asks) {
      setParts(undefined);
      return;
    }
    let live = true;
    void askReadiness({
      documents: [latest.current],
      layout,
      ...(siteDefault ? { siteDefault: true } : {}),
    }).then(answer => {
      if (!live) return;
      setParts(
        answer?.dependencies.map(({ kind, id, title, mayPublish }) => ({
          kind,
          id,
          title,
          mayPublish,
        }))
      );
    });
    return () => {
      live = false;
    };
  }, [asks, layout, siteDefault, storedAt, edited]);
  return parts;
}

/** A header or footer the page shows twice, as the notice says it. */
function doubledRegionFacts(
  inputs: Pick<
    PageCheckFactsInputs,
    "document" | "applied" | "regionCards" | "areaOf" | "currentPage"
  >
): readonly DoubledRegionFact[] | undefined {
  if (inputs.currentPage === null) return undefined;
  return regionsShownTwice(
    pageAsDrawn(inputs.document, inputs.applied),
    inputs.regionCards,
    inputs.areaOf
  ).map(({ region, set }) => ({
    area: region.area,
    nodeIds: region.nodeIds,
    said: twoRegionsWords(region.area, set.setTitle),
  }));
}

/** Every fact Page checks reads of the open page. */
export function usePageCheckFacts(inputs: PageCheckFactsInputs): PageFacts {
  const bindingsToFix = useBindingFacts(inputs.field);
  // Asked of a page only: a component is published with the pages using it.
  const unpublished = useUnpublishedParts(
    inputs.document,
    inputs.layout,
    inputs.document.kind === "page"
  );
  const { document, applied, regionCards, areaOf, currentPage, pageData } =
    inputs;
  // Read again only when what it is read from changes.
  const doubledRegions = useMemo(
    () =>
      doubledRegionFacts({
        document,
        applied,
        regionCards,
        areaOf,
        currentPage,
      }),
    [document, applied, regionCards, areaOf, currentPage]
  );
  return useMemo(() => {
    const data = pageDataFact(pageData);
    return {
      ...(bindingsToFix === undefined ? {} : { bindingsToFix }),
      ...(data === undefined ? {} : { pageData: data }),
      ...(unpublished === undefined ? {} : { unpublished }),
      ...(doubledRegions === undefined ? {} : { doubledRegions }),
    };
  }, [bindingsToFix, pageData, unpublished, doubledRegions]);
}
