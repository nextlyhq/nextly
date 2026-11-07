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
 * - the components the page and its Layout place, by the published
 *   pipeline's own walk (`definitionsFor`) in the route's batches
 *   (`componentBatches`), and the Layout's row;
 * - and the page is drawn inside its Layout, the header and footer under
 *   the same budget, as the published page draws them.
 *
 * It is counted as the person editing sees the page: lists read their
 * drafts too, where a visitor's read may hold fewer entries.
 *
 * The blocks that went unread are named by that draw's budget, so the panel
 * can select them.
 *
 * @module page-read-meter
 */
import {
  DEFAULT_LIMITS,
  type BlockDocument,
  type DefinitionsById,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  componentBatches,
  createQueryBudget,
  createStandaloneContext,
  DEFAULT_MAX_QUERIES,
  definitionsFor,
  emptyDataProvider,
  relatedThrough,
  PageRenderer,
  READ_KINDS,
  type ListBatchReads,
  type PageContext,
  type PageReadReport,
  type PageRendererProps,
  type QueryBudget,
  type ReadClaim,
  type ResolvedMedia,
} from "@nextlyhq/blocks-react";
import {
  ReadBudgetMeter,
  type ReadBudgetMeterProps,
} from "@nextlyhq/builder/shell";
import {
  createElement,
  Fragment,
  useEffect,
  useState,
  type ReactElement,
} from "react";

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
    // Settled only once every read it needed was granted: a link refused
    // is asked again by the next block that draws it, and named as unread,
    // as the published page's resolver leaves it.
    resolve: (collection, id, claim) => {
      const ref = key(collection, id);
      if (
        !known.has(ref) &&
        claimEach(budget, LINK_READS, { ...claim, kind: "link" })
      ) {
        known.add(ref);
      }
      // The canvas draws no address for a link to an entry.
      return Promise.resolve(null);
    },
    ahead: (refs, claim) => {
      for (const ids of unsettled(refs, known, key).values()) {
        for (let at = 0; at < ids.length; at += BATCH_SIZE) {
          const batch = ids.slice(at, at + BATCH_SIZE);
          // Asked only where the allowance also covers each link's own
          // reads after it, as the published page asks a batch.
          if (
            (budget.remaining?.() ?? Infinity) <
            LINK_READS * (batch.length + 1)
          ) {
            return Promise.resolve();
          }
          if (!claimEach(budget, LINK_READS, { ...claim, kind: "link" })) {
            return Promise.resolve();
          }
          for (const id of batch) known.add(id);
        }
      }
      return Promise.resolve();
    },
  };
}

/** The links not yet settled, by collection, each by its kept key. */
function unsettled(
  refs: readonly { readonly collection: string; readonly id: string }[],
  known: ReadonlySet<string>,
  key: (collection: string, id: string) => string
): Map<string, string[]> {
  const byCollection = new Map<string, string[]>();
  for (const { collection, id } of refs) {
    const ref = key(collection, id);
    if (known.has(ref)) continue;
    byCollection.set(collection, [
      ...(byCollection.get(collection) ?? []),
      ref,
    ]);
  }
  return byCollection;
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
      // The published page's own read, through the canvas's data provider,
      // so the rows come back and what a list draws through them (a link
      // or an image by a related entry's field) is counted too.
      related: relatedThrough(base.data ?? emptyDataProvider, shapes, budget),
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
 * The binding reads the canvas bindings route reported, claimed again in
 * the count's budget by kind, the refused ones too: what they cost the page
 * at this point of its reads.
 */
function replayBindingReads(
  bindings: PageReadReport | undefined,
  budget: QueryBudget
): void {
  if (bindings === undefined) return;
  for (const kind of READ_KINDS) {
    for (let read = 0; read < (bindings.byKind[kind] ?? 0); read += 1) {
      budget.take({ kind });
    }
  }
  for (let read = 0; read < bindings.refused; read += 1) budget.take();
}

/** A Layout region the page is drawn inside, as the canvas draws it. */
interface DrawnRegion {
  readonly area: string;
  readonly document: BlockDocument;
  readonly definitions?: DefinitionsById;
}

/**
 * The component reads the published page makes for `document`: its own
 * pipeline's walk (`definitionsFor`, one ask per nesting level) over the
 * definitions the canvas holds, each ask claimed in the batches the route's
 * reads take (`componentBatches`).
 */
async function countComponentReads(
  document: BlockDocument,
  known: DefinitionsById | undefined,
  budget: QueryBudget,
  limits: DocumentLimits
): Promise<void> {
  await definitionsFor(
    document,
    ids => {
      const wanted = [...new Set(ids)].filter(id => id.trim() !== "");
      const found = new Map<string, BlockDocument>();
      for (const batch of componentBatches(wanted, budget)) {
        for (const id of batch) {
          const definition = known?.get(id);
          if (definition !== undefined) found.set(id, definition);
        }
      }
      return Promise.resolve(found);
    },
    limits
  );
}

/**
 * What the page reads when published, in the published page's order, under
 * one budget of `cap`: the components the page and its Layout place, then
 * the binding reads as the canvas bindings route made them, then the page
 * drawn once, off screen, inside its Layout.
 */
export async function countPageReads(
  drawnWith: DrawnWith,
  document: BlockDocument,
  regions: readonly DrawnRegion[],
  /** The allowance counted against: the default a published page has. */
  cap: number = DEFAULT_MAX_QUERIES
): Promise<PageReadReport> {
  const bindings =
    drawnWith.bindings === undefined
      ? undefined
      : bindingReadsOf(drawnWith.bindings);
  const budget = createQueryBudget(cap);
  const limits = drawnWith.limits ?? DEFAULT_LIMITS;
  // What the published page reads before it draws, in its order: the
  // components the page places, then its Layout's row and the components
  // its regions place.
  await countComponentReads(document, drawnWith.definitions, budget, limits);
  if (regions.length > 0) {
    budget.take({ kind: "component" });
    await countComponentReads(
      {
        formatVersion: document.formatVersion,
        kind: "page",
        nodes: regions.flatMap(region => region.document.nodes),
      },
      new Map(
        regions.flatMap(region => [...(region.definitions ?? new Map())])
      ),
      budget,
      limits
    );
  }
  // Then the binding reads, against what the components left, as the
  // published page makes them: each the route reported, claimed again here
  // in the same budget, so the ones past the allowance are refused.
  replayBindingReads(bindings, budget);
  const context = countingContext(drawnWith, budget);
  // The page inside its Layout, as the published page draws it: the
  // header, the page and the footer under the one budget.
  const part = (drawnPart: BlockDocument, definitions?: DefinitionsById) =>
    createElement(PageRenderer, {
      ...drawnWith,
      document: drawnPart,
      context,
      ...(definitions === undefined ? {} : { definitions }),
    });
  const header = regions.find(region => region.area === "header");
  const footer = regions.find(region => region.area === "footer");
  await drawOnce(
    createElement(
      Fragment,
      null,
      header === undefined ? null : part(header.document, header.definitions),
      part(document),
      footer === undefined ? null : part(footer.document, footer.definitions)
    )
  );
  return budget.report();
}

/**
 * The page's count, made again a moment after it last changed. The last
 * count stays shown while the next is made, so the meter does not blink;
 * there is none until the first is made.
 */
function usePageReads(
  drawnWith: DrawnWith,
  document: BlockDocument,
  regions: readonly DrawnRegion[]
): PageReadReport | undefined {
  const [report, setReport] = useState<PageReadReport | undefined>(undefined);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      countPageReads(drawnWith, document, regions).then(
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
  }, [drawnWith, document, regions]);
  return report;
}

export function PageReadMeter({
  editor,
  drawnWith,
  regions,
  componentTitle,
}: Pick<ReadBudgetMeterProps, "editor" | "componentTitle"> & {
  /** What the canvas draws the page with. */
  readonly drawnWith: DrawnWith;
  /** The Layout regions the page is drawn inside. */
  readonly regions: readonly DrawnRegion[];
}): React.JSX.Element {
  const report = usePageReads(drawnWith, editor.document, regions);
  return (
    <ReadBudgetMeter
      report={report}
      editor={editor}
      {...(componentTitle === undefined ? {} : { componentTitle })}
    />
  );
}
