"use client";

/**
 * The page reads meter, as the editor's top bar draws it: what the page being
 * edited reads when it is published, against the allowance a published page
 * renders under, warning from 80% of it.
 *
 * ## How the count is made
 *
 * The canvas cannot be counted as it draws: it keeps each async block's
 * output for the editor's life, so a draw after a selection reads nothing,
 * and it reads through the admin, where several of a published page's reads
 * are never made. So, a moment after the page last changed, the page is drawn
 * once more, off screen, with nothing kept and a budget of its own, counting
 * each read by the published renderer's own claims:
 * - the reads behind its bindings (the entry, its Singles, the site settings
 *   and the relations they follow) as the canvas bindings route made them,
 *   which reports what they cost, so they are counted, not worked out again;
 * - its lists' entries and its named queries' runs, read as the canvas reads
 *   them;
 * - each distinct image, one read, as the published page reads it;
 * - each relation a list's items follow, one read per list, and each link to
 *   an entry, three reads (its row and two ownership checks), or three per
 *   list for a list's links: counted as the published page counts them,
 *   without the read, since the canvas draws neither.
 *
 * The blocks that went unread are named by that draw's budget, so the panel
 * can select them.
 *
 * @module page-read-meter
 */
import {
  bindingKindOf,
  type BindingFieldShape,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  createQueryBudget,
  createStandaloneContext,
  DEFAULT_MAX_QUERIES,
  PageRenderer,
  READ_KINDS,
  type ListBatchReads,
  type PageContext,
  type PageReadReport,
  type PageRendererProps,
  type QueryBudget,
  type ReadClaim,
  type ReadKind,
  type ResolvedMedia,
} from "@nextlyhq/blocks-react";
import {
  ReadBudgetMeter,
  type ReadBudgetMeterProps,
} from "@nextlyhq/builder/shell";
import { createElement, useEffect, useState, type ReactElement } from "react";

import { bindingReadsOf } from "../canvas-bindings-client";

/** What the page is drawn with on the canvas, which the count draws again. */
type DrawnWith = Omit<PageRendererProps, "document" | "siteStyles">;

/** How long the page must stay unchanged before it is counted again. */
const COUNT_AFTER_MS = 600;

/** What one link to an entry costs a published page: its row, two checks. */
const LINK_READS = 3;

/** How many ids one batched read takes, as the published page batches them. */
const BATCH_SIZE = 100;

/** Claim `count` reads, stopping at the first refused. */
function claimEach(
  budget: QueryBudget,
  count: number,
  claim: ReadClaim
): boolean {
  for (let read = 0; read < count; read += 1) {
    if (!budget.take(claim)) return false;
  }
  return true;
}

/** Each image once, as the published page reads it. */
function countedMedia(
  base: PageContext,
  budget: QueryBudget
): PageContext["resolveMedia"] {
  const known = new Map<string, Promise<ResolvedMedia | null>>();
  return (id, claim) => {
    const kept = known.get(id);
    if (kept !== undefined) return kept;
    if (!budget.take({ ...claim, kind: "image" })) return Promise.resolve(null);
    const reading = base.resolveMedia(id).catch(() => null);
    known.set(id, reading);
    return reading;
  };
}

/** Whether `field` of a collection is a to-one relation a list can follow. */
function followable(
  fields: readonly BindingFieldShape[] | undefined,
  field: string
): boolean {
  const shape = fields?.find(candidate => candidate.name === field);
  return (
    shape !== undefined &&
    shape.hasMany !== true &&
    bindingKindOf(shape) === "reference" &&
    typeof shape.relationTo === "string"
  );
}

/**
 * Links and a list's batches, counted as the published page counts them:
 * one entry's link once, at {@link LINK_READS}; a list's links into one
 * collection at {@link LINK_READS} per batch, and then not again per entry.
 */
function countedLinks(budget: QueryBudget): {
  resolve: PageContext["resolveEntryPath"];
  ahead: ListBatchReads["entryPaths"];
} {
  const known = new Set<string>();
  const key = (collection: string, id: string) => `${collection}\u0000${id}`;
  return {
    resolve: (collection, id, claim) => {
      const ref = key(collection, id);
      if (!known.has(ref)) {
        known.add(ref);
        claimEach(budget, LINK_READS, { ...claim, kind: "link" });
      }
      // The canvas draws no address for a link to an entry.
      return Promise.resolve(null);
    },
    ahead: (refs, claim) => {
      const byCollection = new Map<string, string[]>();
      for (const { collection, id } of refs) {
        if (known.has(key(collection, id))) continue;
        known.add(key(collection, id));
        byCollection.set(collection, [
          ...(byCollection.get(collection) ?? []),
          id,
        ]);
      }
      for (const ids of byCollection.values()) {
        for (let at = 0; at < ids.length; at += BATCH_SIZE) {
          claimEach(budget, LINK_READS, { ...claim, kind: "link" });
        }
      }
      return Promise.resolve();
    },
  };
}

/** A count's reads by kind, added to another's. */
function addKinds(
  one: PageReadReport["byKind"],
  other: PageReadReport["byKind"]
): PageReadReport["byKind"] {
  const sum: Partial<Record<ReadKind, number>> = { ...one };
  for (const kind of READ_KINDS) {
    const count = other[kind];
    if (count !== undefined) sum[kind] = (sum[kind] ?? 0) + count;
  }
  return sum;
}

/**
 * The context the count draws the page under: the canvas's own, with a
 * budget of its own and the published page's claims for what the canvas
 * does not read.
 */
function countingContext(
  drawnWith: DrawnWith,
  budget: QueryBudget
): PageContext {
  const shapes = drawnWith.bindings?.fieldShapes;
  const links = countedLinks(budget);
  const {
    // Lists an author chose to see empty, or that wait for an input, read
    // nothing on the canvas and read on the published page.
    listsShowingEmpty: _empty,
    listsStillShowing: _still,
    ...base
  } = drawnWith.context ?? createStandaloneContext();
  return {
    ...base,
    queries: budget,
    resolveMedia: countedMedia(base, budget),
    resolveEntryPath: links.resolve,
    listReads: {
      related: (collection, field, ids, _fields, claim) => {
        if (followable(shapes?.fieldsOf({ collection }), field)) {
          const distinct = new Set(ids.map(String)).size;
          for (let at = 0; at < distinct; at += BATCH_SIZE) {
            if (!budget.take({ ...claim, kind: "related" })) break;
          }
        }
        // Counted, not read: the canvas draws a list item's relation as it
        // always has.
        return Promise.resolve(undefined);
      },
      entryPaths: links.ahead,
    },
  };
}

/** Draw a page to nowhere, every async block settled. */
async function drawOnce(element: ReactElement): Promise<void> {
  const { renderToReadableStream } = await import("react-dom/server");
  const stream = await renderToReadableStream(element, {
    // A block that fails is the page's to show, not the count's.
    onError: () => undefined,
  });
  await stream.allReady;
  await stream.cancel();
}

/**
 * What the page reads when published: drawn once, off screen, under a
 * budget of what the binding reads left, then added to those reads.
 */
async function countPageReads(
  drawnWith: DrawnWith,
  document: BlockDocument
): Promise<PageReadReport> {
  const bindings =
    drawnWith.bindings === undefined
      ? undefined
      : bindingReadsOf(drawnWith.bindings);
  const spent = bindings?.used ?? 0;
  const budget = createQueryBudget(Math.max(0, DEFAULT_MAX_QUERIES - spent));
  const context = countingContext(drawnWith, budget);
  await drawOnce(
    createElement(PageRenderer, { ...drawnWith, document, context })
  );
  const drawn = budget.report();
  return {
    cap: DEFAULT_MAX_QUERIES,
    used: spent + drawn.used,
    refused: (bindings?.refused ?? 0) + drawn.refused,
    byKind: addKinds(bindings?.byKind ?? {}, drawn.byKind),
    unread: drawn.unread,
  };
}

/**
 * The page's count, made again a moment after it last changed. The last
 * count stays shown while the next is made, so the meter does not blink;
 * there is none until the first is made.
 */
function usePageReads(
  drawnWith: DrawnWith,
  document: BlockDocument
): PageReadReport | undefined {
  const [report, setReport] = useState<PageReadReport | undefined>(undefined);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      countPageReads(drawnWith, document).then(
        counted => {
          if (current) setReport(counted);
        },
        // A count that could not be made leaves the last one shown.
        () => undefined
      );
    }, COUNT_AFTER_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [drawnWith, document]);
  return report;
}

export function PageReadMeter({
  editor,
  drawnWith,
  componentTitle,
}: Pick<ReadBudgetMeterProps, "editor" | "componentTitle"> & {
  /** What the canvas draws the page with. */
  readonly drawnWith: DrawnWith;
}): React.JSX.Element {
  const report = usePageReads(drawnWith, editor.document);
  return (
    <ReadBudgetMeter
      report={report}
      editor={editor}
      {...(componentTitle === undefined ? {} : { componentTitle })}
    />
  );
}
