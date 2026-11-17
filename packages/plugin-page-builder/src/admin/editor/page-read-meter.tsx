"use client";

/**
 * The page data meter: what the page being edited reads when it is
 * published, against the site's page data limit, counted once and drawn in
 * two places. The top bar shows it only from 80% of the limit (or when the
 * count fails); Page settings shows it at every level.
 *
 * The limit is the site's: `pageBuilder({ maxQueries })`, sent to the editor
 * in the admin's client config, which the page routes render under too where
 * they set no `maxQueries` of their own. Unset, it is the default, 500.
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
  useMemo,
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

/**
 * How long the page must stay unchanged before it is counted again. A count
 * draws the whole page on the main thread, so it waits for the author to
 * stop working rather than competing with what they are doing.
 */
const COUNT_AFTER_MS = 2000;

/**
 * The longest a count, once the page has rested, waits for the browser to be
 * idle: past it, the count is made anyway, so a page kept busy by something
 * other than the author is still counted.
 */
const IDLE_WITHIN_MS = 1000;

/** Run `run` when the browser is next idle, or at once where it cannot say. */
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(run, { timeout: IDLE_WITHIN_MS });
    return () => cancelIdleCallback(handle);
  }
  run();
  return () => undefined;
}

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
 * - **A count waits for the author to rest.** It is made once the page has
 *   gone {@link COUNT_AFTER_MS} without a change, when the browser is next
 *   idle. A page that keeps changing is not counted until it rests: a count
 *   draws the whole page on the main thread, and while the author works that
 *   draw would compete with them.
 * - **An edit stops a count being made.** A change made while a count is
 *   being made aborts it, since its answer would already be out of date, and
 *   the count waits for the page to rest again. So at most one count is ever
 *   being made.
 * - **A count has its while.** From when a count begins, the meter is told
 *   a count or a failure within {@link COUNT_GIVES_UP_MS}: a read that never
 *   answers would otherwise leave it counting for good.
 * - **A count given up on stops the counting.** The meter says the count
 *   could not be made, and no count is made again until Retry, which aborts
 *   the one given up on, as an edit does: one started after each deadline
 *   would leave a stalled count running for every 20 seconds the page stays
 *   open. Should the count given up on answer after all, its answer is told
 *   if the page has not changed since it began.
 * - **A failure is said.** A count that fails is told as one that could not
 *   be made.
 */
class CountScheduler {
  private make: MakeCount | undefined;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  /** Stops the wait for the browser to be idle, while one is in hand. */
  private cancelIdle: (() => void) | undefined;
  /** The count being made, by its number; 0 when none is. */
  private inFlight = 0;
  /** What aborts the latest count begun. */
  private controller: AbortController | undefined;
  /** The page changed since the count given up on began. */
  private changedSince = false;
  /** The deadline of the count being made; `undefined` when none is. */
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
    if (this.stopped) {
      // The count given up on is stopped too: its draw would otherwise go on
      // while the author works, for an answer the change has made stale.
      this.changedSince = true;
      this.controller?.abort();
      return;
    }
    if (this.inFlight !== 0) this.stopCount();
    this.wait(COUNT_AFTER_MS);
  }

  /**
   * Count again now, showing the meter as counting meanwhile. A count still
   * being made, one given up on among them, is aborted.
   */
  retry(): void {
    this.stopCount();
    this.stopped = false;
    this.changedSince = false;
    this.show(NOT_COUNTED);
    this.wait(0);
  }

  dispose(): void {
    this.disposed = true;
    this.stopWaiting();
    clearTimeout(this.deadline);
    this.controller?.abort();
  }

  /** Abort the count being made, if one is; its answer is not told. */
  private stopCount(): void {
    this.controller?.abort();
    this.inFlight = 0;
    clearTimeout(this.deadline);
    this.deadline = undefined;
  }

  private stopWaiting(): void {
    clearTimeout(this.waitTimer);
    this.waitTimer = undefined;
    this.cancelIdle?.();
    this.cancelIdle = undefined;
  }

  /** Count once `ms` pass with no change, when the browser is next idle. */
  private wait(ms: number): void {
    this.stopWaiting();
    this.waitTimer = setTimeout(() => {
      this.waitTimer = undefined;
      this.cancelIdle = whenIdle(() => {
        this.cancelIdle = undefined;
        this.start();
      });
    }, ms);
  }

  private start(): void {
    const make = this.make;
    if (make === undefined || this.disposed) return;
    // A failure said is no longer the meter's to say once another count is
    // under way: it reads as counting. A count shown stays shown, so the
    // meter does not blink while it is counted again.
    if (this.failing) this.show(NOT_COUNTED);
    this.counts += 1;
    const count = this.counts;
    this.inFlight = count;
    this.changedSince = false;
    this.controller = new AbortController();
    this.deadline = setTimeout(() => this.giveUp(), COUNT_GIVES_UP_MS);
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
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.show(shown);
  }

  private giveUp(): void {
    this.deadline = undefined;
    if (this.disposed) return;
    this.stopped = true;
    this.inFlight = 0;
    this.stopWaiting();
    this.show(FAILED);
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
  regions: readonly CountedRegion[],
  /** The site's page data limit; the default where it sets none. */
  cap: number | undefined,
  /** Whether to count at all: a page is counted, nothing else is. */
  counts: boolean
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
    if (!counts) return;
    scheduler.current?.changed(signal =>
      countPageReads(drawnWith, document, regions, cap, {
        ...readsNow.current,
        signal,
      })
    );
  }, [drawnWith, document, regions, reader, cap, counts]);
  const retry = useCallback(() => scheduler.current?.retry(), []);
  return { report: shown.report, retry: shown.failed ? retry : undefined };
}

/**
 * The site's page data limit as the admin's client config carries it:
 * a whole number from 0, `null` for no limit, or `undefined` (the default)
 * for anything else, as the plugin sends nothing else.
 */
export function readPageDataLimit(
  clientConfig: Readonly<Record<string, unknown>> | undefined
): number | undefined {
  const sent = clientConfig?.maxQueries;
  if (sent === null) return Number.POSITIVE_INFINITY;
  return typeof sent === "number" && Number.isInteger(sent) && sent >= 0
    ? sent
    : undefined;
}

/** The page's count, made once, for the top bar's meter and Page settings'. */
export interface PageDataCount
  extends Pick<ReadBudgetMeterProps, "editor" | "componentTitle"> {
  readonly report: PageReadReport | undefined;
  readonly retry: (() => void) | undefined;
  readonly regions: NonNullable<ReadBudgetMeterProps["regions"]>;
}

/** What the page's count is made with. */
export interface PageDataCountInputs
  extends Pick<ReadBudgetMeterProps, "editor" | "componentTitle"> {
  /**
   * Whether the open document is counted: a page is; a component or a
   * Layout is read as part of each page placing it, so it has no count.
   */
  readonly counts: boolean;
  /** What the canvas draws the page with. */
  readonly drawnWith: CountedDrawing;
  /**
   * The Layout regions the page is drawn inside, as the canvas draws them:
   * counted with the page, and where a block of theirs went unread, named
   * with the Layout it comes from.
   */
  readonly regions: NonNullable<ReadBudgetMeterProps["regions"]>;
  /** The site's page data limit (`readPageDataLimit`); 500 when unset. */
  readonly cap?: number | undefined;
}

/**
 * Counts the page, once, for every meter that draws it: the top bar's and
 * Page settings' read the same count, so they cannot disagree, and the page
 * is not drawn twice to count it. The count runs while the bar's meter is
 * hidden, since the bar must know when to show it. `null` where the open
 * document is not counted.
 */
export function usePageDataCount({
  counts,
  editor,
  drawnWith,
  regions,
  componentTitle,
  cap,
}: PageDataCountInputs): PageDataCount | null {
  const { report, retry } = usePageReads(
    drawnWith,
    editor.document,
    regions,
    cap,
    counts
  );
  return useMemo(
    () => (counts ? { report, retry, editor, regions, componentTitle } : null),
    [counts, report, retry, editor, regions, componentTitle]
  );
}

/**
 * The page data meter, drawing `count`: in the top bar (the default), shown
 * from 80% of the limit or when the count fails; in Page settings, at every
 * level. Nothing for a document that is not counted.
 */
export function PageReadMeter({
  count,
  place = "bar",
}: {
  readonly count: PageDataCount | null;
  readonly place?: "bar" | "settings";
}): React.JSX.Element | null {
  if (count === null) return null;
  const { report, retry, editor, regions, componentTitle } = count;
  return (
    <ReadBudgetMeter
      report={report}
      failed={retry === undefined ? undefined : { retry }}
      editor={editor}
      regions={regions}
      place={place}
      {...(componentTitle === undefined ? {} : { componentTitle })}
    />
  );
}
