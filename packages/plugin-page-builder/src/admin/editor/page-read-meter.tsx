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
 * once more, off screen, with nothing kept and a budget of its own, through
 * the published route's own read stages (`countPageReads`, which runs them):
 * the components the page and its Layout place, what its bindings and its
 * conditions read, its lists' day terms, the first read of the list it pages,
 * then the page inside its Layout, as the route draws it.
 *
 * What this module gives the stages is where the editor reads:
 * - the definitions the editor holds, and the Layout it draws the page in;
 * - the bindings and the entry fields the page's conditions check, read by
 *   the canvas bindings route through the published page's own read
 *   (`readBindingSources`) under the reads the page has left at that point,
 *   and what that cost is claimed in the count, so a read past the allowance
 *   is refused where the published page refuses it;
 * - the canvas's lists, read as the canvas reads them.
 *
 * It is counted as the person editing sees the page: lists read their
 * drafts too, where a visitor's read may hold fewer entries. A list's days
 * are compared in UTC unless the page's bindings read the site's zone, since
 * the editor reads no site settings of its own; that read is counted.
 *
 * The blocks that went unread are named by that draw's budget, so the panel
 * can select them.
 *
 * @module page-read-meter
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  countPageReads as countWithStages,
  type BindingsAsk,
  type CountedBindings,
  type CountedDrawing,
  type CountedRegion,
  type EntrySource,
  type PageReadReport,
  type PageWhere,
} from "@nextlyhq/blocks-react";
import {
  ReadBudgetMeter,
  type ReadBudgetMeterProps,
} from "@nextlyhq/builder/shell";
import {
  useCurrentUserId,
  type DocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import {
  bindingReadsOf,
  canvasBindingsFor,
  canvasBindingsRequest,
} from "../canvas-bindings-client";

import { useCanvasEntryIdentity } from "./canvas-entry";

/** How long the page must stay unchanged before it is counted again. */
const COUNT_AFTER_MS = 600;

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

/** Where a list's page link points in the count: nowhere it is followed. */
function countedPageHref(page: number): string {
  return `#page-${String(page)}`;
}

/** How the count reads what only the server reads, and where the page is. */
export interface PageCountReads {
  /** Where the page's entry lives; a collection's, unless said. */
  readonly entrySource?: EntrySource;
  /** The page's bindings and conditions' fields, under `allowance` reads. */
  readonly readBindings?: (
    ask: BindingsAsk,
    allowance: number
  ) => Promise<CountedBindings | undefined>;
}

/**
 * The bindings the canvas drew the page with, and what the route said they
 * cost: what a count asks of when nothing reads them again for it.
 */
function drawnBindings(
  drawnWith: CountedDrawing
): () => Promise<CountedBindings | undefined> {
  return () => {
    const bindings = drawnWith.bindings;
    if (bindings === undefined) return Promise.resolve(undefined);
    const reads = bindingReadsOf(bindings);
    return Promise.resolve(
      reads === undefined ? { bindings } : { bindings, reads }
    );
  };
}

/**
 * What the page reads when published, in the published route's order and by
 * its stages, under one budget of `cap`, drawn inside its Layout.
 */
export async function countPageReads(
  drawnWith: CountedDrawing,
  document: BlockDocument,
  regions: readonly CountedRegion[],
  /** The allowance counted against: the default a published page has. */
  cap?: number,
  reads: PageCountReads = {}
): Promise<PageReadReport> {
  const entrySource = reads.entrySource ?? "collection";
  const locale = drawnWith.context?.locale;
  const where: PageWhere = {
    collection: drawnWith.context?.entryCollection ?? "",
    slug: "",
    ...(locale === undefined ? {} : { locale }),
    page: 1,
    // A collection's route serves a list's later pages; a Single's none.
    ...(entrySource === "collection" ? { listPagePath: countedPageHref } : {}),
  };
  return await countWithStages({
    drawnWith,
    document,
    regions,
    entrySource,
    where,
    readBindings: reads.readBindings ?? drawnBindings(drawnWith),
    draw: drawOnce,
    ...(cap === undefined ? {} : { cap }),
  });
}

/**
 * How the count reads a page's bindings: through the canvas bindings route,
 * as the person editing, asking what the published page's own stage asks
 * (the documents it reads, its conditions' fields) under the reads it has
 * left.
 */
function routeBindings(
  identity: DocumentIdentity | null,
  userId: string | null,
  drawnWith: CountedDrawing
): PageCountReads["readBindings"] {
  return async (ask, allowance) => {
    const request = canvasBindingsRequest(
      ask.documents,
      identity,
      drawnWith.context?.locale,
      false,
      drawnWith.context?.namedQueries,
      {
        ...(ask.conditions === undefined ? {} : { conditions: ask.conditions }),
        allowance,
      }
    );
    if (request === undefined || userId === null) return undefined;
    const bindings = await canvasBindingsFor(request, userId);
    const reads = bindingReadsOf(bindings);
    return reads === undefined ? { bindings } : { bindings, reads };
  };
}

/**
 * The longest a count waits for the page to stop changing, from the first
 * change it waits on: a page whose inputs change more often than
 * {@link COUNT_AFTER_MS} is still counted, rather than put off for good.
 */
const COUNT_WITHIN_MS = 3000;

/**
 * How long a count may take before the meter says it could not be made: a
 * read that never answers (a stalled request, a block that never settles)
 * would otherwise leave it counting for good. A count of a page at its
 * allowance's 500 reads takes a few seconds.
 */
const COUNT_GIVES_UP_MS = 20_000;

/** What the meter shows: the latest count, none yet, or a failed one. */
type ShownCount =
  | { readonly report: PageReadReport | undefined; readonly failed: false }
  | { readonly report: undefined; readonly failed: true };

const NOT_COUNTED: ShownCount = { report: undefined, failed: false };

const FAILED: ShownCount = { report: undefined, failed: true };

/** What `usePageReads` answers. */
interface PageReads {
  readonly report: PageReadReport | undefined;
  /** Given when the latest count could not be made: counts again now. */
  readonly retry: (() => void) | undefined;
}

/**
 * How long a count waits now, a change having been made: the moment the
 * page is given to settle, but never past {@link COUNT_WITHIN_MS} from the
 * first change it has waited on (`since`).
 */
function countWait(since: number, now: number): number {
  return Math.min(COUNT_AFTER_MS, Math.max(0, since + COUNT_WITHIN_MS - now));
}

/**
 * Who reads the page, by value: the person, and the entry it is drawn as.
 * The form's identity is a new object on every render, so it is compared by
 * what it names.
 */
function readerKey(
  identity: DocumentIdentity | null,
  userId: string | null
): string {
  return [
    userId ?? "",
    identity?.kind ?? "",
    identity?.slug ?? "",
    identity?.documentId ?? "",
  ].join("\u0000");
}

/** What a count is made with: the page's inputs as they are when it starts. */
type MakeCount = () => Promise<PageReadReport>;

/**
 * When the page's counts are made, and what the meter is told of them.
 *
 * - **A change waits.** A count is made {@link COUNT_AFTER_MS} after the
 *   page last changed, and never more than {@link COUNT_WITHIN_MS} after the
 *   first change it waited on.
 * - **One count at a time.** A change made while a count is being made is
 *   remembered, and exactly one count is made with the latest inputs once
 *   that one answers or gives up. Counts started over one another would each
 *   be overtaken before it answered, and the meter would wait on them all.
 * - **One deadline per wait.** From the first change the meter waits on, it
 *   is told a count or a failure within {@link COUNT_GIVES_UP_MS}, however
 *   the page goes on changing: a read that never answers would otherwise
 *   leave it counting for good.
 * - **A failure is said.** A count that fails, or does not answer in time,
 *   is told as one that could not be made. One that answers after its time
 *   is told only if nothing has been asked since.
 */
class CountScheduler {
  private make: MakeCount | undefined;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  private waitingSince: number | undefined;
  /** The count being made, by its number; 0 when none is. */
  private inFlight = 0;
  /** The page changed while a count was being made. */
  private changedSince = false;
  /** The deadline of the wait in hand; `undefined` when none is. */
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private counts = 0;
  private disposed = false;

  constructor(private readonly tell: (shown: ShownCount) => void) {}

  /** The page changed: `make` counts it as it is now. */
  changed(make: MakeCount): void {
    this.make = make;
    this.awaitAnswer();
    if (this.inFlight !== 0) {
      this.changedSince = true;
      return;
    }
    this.wait(countWait(this.since(), Date.now()));
  }

  /** Count again now, showing the meter as counting meanwhile. */
  retry(): void {
    this.tell(NOT_COUNTED);
    this.awaitAnswer();
    if (this.inFlight !== 0) {
      this.changedSince = true;
      return;
    }
    this.wait(0);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.waitTimer);
    clearTimeout(this.deadline);
  }

  private since(): number {
    this.waitingSince ??= Date.now();
    return this.waitingSince;
  }

  private wait(ms: number): void {
    clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => this.start(), ms);
  }

  private awaitAnswer(): void {
    this.deadline ??= setTimeout(() => this.giveUp(), COUNT_GIVES_UP_MS);
  }

  private answered(): void {
    clearTimeout(this.deadline);
    this.deadline = undefined;
  }

  private start(): void {
    const make = this.make;
    this.waitTimer = undefined;
    this.waitingSince = undefined;
    this.changedSince = false;
    if (make === undefined) return;
    this.counts += 1;
    const count = this.counts;
    this.inFlight = count;
    make().then(
      report => this.settle(count, { report, failed: false }),
      () => this.settle(count, FAILED)
    );
  }

  private settle(count: number, shown: ShownCount): void {
    if (this.disposed) return;
    if (this.inFlight !== count) {
      // Given up on already: told only if nothing has been asked since.
      if (count === this.counts && this.deadline === undefined) {
        this.tell(shown);
      }
      return;
    }
    this.inFlight = 0;
    this.answered();
    this.tell(shown);
    this.next();
  }

  private giveUp(): void {
    this.deadline = undefined;
    if (this.disposed) return;
    this.inFlight = 0;
    this.tell(FAILED);
    // A count still waiting to start has a deadline of its own.
    if (this.waitTimer !== undefined) this.awaitAnswer();
    this.next();
  }

  /** The one count the changes made meanwhile ask for, made now. */
  private next(): void {
    if (!this.changedSince) return;
    this.awaitAnswer();
    this.start();
  }
}

/**
 * The page's count, made again a moment after it last changed. The last
 * count stays shown while the next is made, so the meter does not blink;
 * there is none until the first is made. A count that could not be made is
 * said, with the way to make it again, rather than left counting. When
 * counts are made: {@link CountScheduler}.
 *
 * What starts a count is the page changing: what the canvas draws it with,
 * its document and its Layout's regions, and who reads it (by value). A
 * render of the editor is not a change of the page: were it one, an editor
 * rendering more often than {@link COUNT_AFTER_MS} would put the count off
 * for good.
 */
function usePageReads(
  drawnWith: CountedDrawing,
  document: BlockDocument,
  regions: readonly CountedRegion[]
): PageReads {
  const [shown, setShown] = useState<ShownCount>(NOT_COUNTED);
  // The entry the canvas is drawn as, and the person reading it, so the
  // bindings are read as the canvas reads them.
  const identity = useCanvasEntryIdentity();
  const userId = useCurrentUserId();
  const reader = readerKey(identity, userId);
  // The reads as of the latest render, which a count takes when it starts.
  const readsNow = useRef<PageCountReads>({});
  useEffect(() => {
    readsNow.current = {
      entrySource: identity?.kind ?? "collection",
      readBindings: routeBindings(identity, userId, drawnWith),
    };
  });
  // One scheduler for the meter's life, made before the first change is
  // told to it.
  const scheduler = useRef<CountScheduler | null>(null);
  useEffect(() => {
    const made = new CountScheduler(setShown);
    scheduler.current = made;
    return () => {
      made.dispose();
      scheduler.current = null;
    };
  }, []);
  useEffect(() => {
    scheduler.current?.changed(() =>
      countPageReads(drawnWith, document, regions, undefined, readsNow.current)
    );
  }, [drawnWith, document, regions, reader]);
  const retry = useCallback(() => scheduler.current?.retry(), []);
  return { report: shown.report, retry: shown.failed ? retry : undefined };
}

export function PageReadMeter({
  editor,
  drawnWith,
  regions,
  componentTitle,
}: Pick<ReadBudgetMeterProps, "editor" | "componentTitle"> & {
  /** What the canvas draws the page with. */
  readonly drawnWith: CountedDrawing;
  /**
   * The Layout regions the page is drawn inside, as the canvas draws them:
   * counted with the page, and where a block of theirs went unread, named
   * with the Layout it comes from.
   */
  readonly regions: NonNullable<ReadBudgetMeterProps["regions"]>;
}): React.JSX.Element {
  const { report, retry } = usePageReads(drawnWith, editor.document, regions);
  return (
    <ReadBudgetMeter
      report={report}
      failed={retry === undefined ? undefined : { retry }}
      editor={editor}
      regions={regions}
      {...(componentTitle === undefined ? {} : { componentTitle })}
    />
  );
}
