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

/**
 * Draw a page to nowhere, every async block settled. A count given up on
 * stops here: an aborted `signal` ends the draw, and a draw asked after it
 * is never begun.
 */
async function drawOnce(
  element: ReactElement,
  signal: AbortSignal | undefined
): Promise<void> {
  signal?.throwIfAborted();
  const { renderToReadableStream } = await import("react-dom/server");
  const stream = await renderToReadableStream(element, {
    // A block that fails is the page's to show, not the count's.
    onError: () => undefined,
    ...(signal === undefined ? {} : { signal }),
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
  /**
   * Ends the count when aborted: its draw stops, its request to the
   * bindings route is aborted, and it asks nothing further.
   */
  readonly signal?: AbortSignal;
  /** The page's bindings and conditions' fields, under `allowance` reads. */
  readonly readBindings?: (
    ask: BindingsAsk,
    allowance: number,
    /** The count's own `signal`, which aborts the read when it is asked. */
    signal?: AbortSignal
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
 * A bindings read handed the count's `signal`, which aborts it, and not
 * asked at all once the signal has been aborted.
 */
function withSignal(
  read: NonNullable<PageCountReads["readBindings"]>,
  signal: AbortSignal | undefined
): (ask: BindingsAsk, allowance: number) => ReturnType<typeof read> {
  if (signal === undefined) return (ask, allowance) => read(ask, allowance);
  return async (ask, allowance) => {
    signal.throwIfAborted();
    return await read(ask, allowance, signal);
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
    readBindings: withSignal(
      reads.readBindings ?? drawnBindings(drawnWith),
      reads.signal
    ),
    draw: element => drawOnce(element, reads.signal),
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
  return async (ask, allowance, signal) => {
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
    // The count's own ask, aborted with it: the route's request is stopped,
    // not left to answer nobody.
    const bindings = await canvasBindingsFor(
      request,
      userId,
      undefined,
      false,
      signal
    );
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
type MakeCount = (signal: AbortSignal) => Promise<PageReadReport>;

/**
 * When the page's counts are made, and what the meter is told of them.
 *
 * - **A change waits.** A count is made {@link COUNT_AFTER_MS} after the
 *   page last changed, and never more than {@link COUNT_WITHIN_MS} after the
 *   first change it waited on.
 * - **One count at a time.** A change made while a count is being made is
 *   remembered, and exactly one count is made with the latest inputs once
 *   that one answers. Counts started over one another would each be
 *   overtaken before it answered, and the meter would wait on them all.
 * - **One deadline per wait.** From the first change the meter waits on, it
 *   is told a count or a failure within {@link COUNT_GIVES_UP_MS}, however
 *   the page goes on changing: a read that never answers would otherwise
 *   leave it counting for good.
 * - **A count given up on stops the counting.** The meter says the count
 *   could not be made, and no count is made again until Retry, which aborts
 *   the one given up on: one started after each deadline would leave a
 *   stalled count running for every 20 seconds the page stays open. Should
 *   the count given up on answer after all, its answer is told if the page
 *   has not changed since it began.
 * - **A failure is said.** A count that fails is told as one that could not
 *   be made; one asked for by a change made meanwhile is still made, and the
 *   meter reads as counting while it is.
 */
class CountScheduler {
  private make: MakeCount | undefined;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  private waitingSince: number | undefined;
  /** The count being made, by its number; 0 when none is. */
  private inFlight = 0;
  /** What aborts the latest count begun. */
  private controller: AbortController | undefined;
  /** The page changed since the latest count began. */
  private changedSince = false;
  /** The deadline of the wait in hand; `undefined` when none is. */
  private deadline: ReturnType<typeof setTimeout> | undefined;
  /** A count was given up on: nothing is counted until Retry. */
  private stopped = false;
  /** The meter is showing a count that could not be made. */
  private failing = false;
  private counts = 0;
  private disposed = false;

  constructor(private readonly tell: (shown: ShownCount) => void) {}

  /** Tell the meter what to show, and remember whether it is a failure. */
  private show(shown: ShownCount): void {
    this.failing = shown.failed;
    this.tell(shown);
  }

  /** The page changed: `make` counts it as it is now. */
  changed(make: MakeCount): void {
    this.make = make;
    if (this.stopped || this.inFlight !== 0) {
      this.changedSince = true;
      if (this.stopped) return;
    }
    this.awaitAnswer();
    if (this.inFlight !== 0) return;
    this.wait(countWait(this.since(), Date.now()));
  }

  /**
   * Count again now, showing the meter as counting meanwhile. A count still
   * being made, one given up on among them, is aborted.
   */
  retry(): void {
    this.controller?.abort();
    this.stopped = false;
    this.inFlight = 0;
    this.show(NOT_COUNTED);
    this.awaitAnswer();
    this.wait(0);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.waitTimer);
    clearTimeout(this.deadline);
    this.controller?.abort();
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
    // A failure said is no longer the meter's to say once another count is
    // under way: it reads as counting. A count shown stays shown, so the
    // meter does not blink while it is counted again.
    if (this.failing) this.show(NOT_COUNTED);
    this.counts += 1;
    const count = this.counts;
    this.inFlight = count;
    this.controller = new AbortController();
    make(this.controller.signal).then(
      report => this.settle(count, { report, failed: false }),
      () => this.settle(count, FAILED)
    );
  }

  private settle(count: number, shown: ShownCount): void {
    if (this.disposed || count !== this.counts) return;
    if (this.stopped) {
      // The count given up on, answering after all: told if the page has
      // not changed since it began, and counting goes on as before.
      if (shown.failed || this.changedSince) return;
      this.stopped = false;
      this.show(shown);
      return;
    }
    if (this.inFlight !== count) return;
    this.inFlight = 0;
    this.answered();
    this.show(shown);
    this.next();
  }

  private giveUp(): void {
    this.deadline = undefined;
    if (this.disposed) return;
    this.stopped = true;
    this.inFlight = 0;
    clearTimeout(this.waitTimer);
    this.waitTimer = undefined;
    this.waitingSince = undefined;
    this.show(FAILED);
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
    scheduler.current?.changed(signal =>
      countPageReads(drawnWith, document, regions, undefined, {
        ...readsNow.current,
        signal,
      })
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
