/**
 * How widely the rows on screen are used, read from a host's usage route and
 * kept as the reads answer: one machine for every Design tab that shows
 * counts, the Shared styles tab and the Variables tab, generic over what one
 * id's usage is.
 *
 * ## Reads
 *
 * Each id is asked about once, at most {@link USAGE_READ_SIZE} to a read, as
 * rows come on screen; a row already read is not asked again while the
 * counts are whole. While some pages are still being counted, every row on
 * screen is asked again each {@link USAGE_RECOUNT_MS}, until the counts are
 * whole or {@link USAGE_RECOUNT_IDLE_MAX} recounts in a row changed nothing.
 *
 * ## Count now
 *
 * Where the host can count the site's pages now and the author may, the
 * reads offer it ({@link CountNow}); its answer reads the rows again.
 *
 * @module usage-reads
 */
import * as React from "react";

import { BACKGROUND_JOBS_DOCS_HREF } from "./docs-links";
import type { SharedStylesCount } from "./shared-style-library";

/** The most ids one usage read asks about. */
const USAGE_READ_SIZE = 50;

/**
 * How long the rows on screen wait before their usage is asked again while
 * some pages are still being counted, so the counts become whole, and a
 * removal becomes possible, without reopening the tab.
 */
export const USAGE_RECOUNT_MS = 15_000;

/**
 * How many times in a row the rows are asked again with nothing changing:
 * five minutes of recounts. A site says it is counting when the backfill
 * still has pages to count, but only a scheduler running the site's jobs
 * counts them, so on a site with none it says so for ever; and a host
 * written before `counting` existed does not say at all. Either way the tab
 * stops asking rather than polling for as long as it stays open, and any
 * change in the counts, or an id not read before, renews it.
 */
export const USAGE_RECOUNT_IDLE_MAX = 20;

/** One read of how widely some ids are used, as the reads take it. */
export interface UsageRead<R> {
  /** Whether every page has been counted, so counts can be exact. */
  readonly whole: boolean;
  /**
   * Whether counts that are not whole may still become whole. Absent means
   * unknown, asked again as while counting.
   */
  readonly counting?: boolean;
  /** Whether this author may ask for the pages to be counted now. Absent: no. */
  readonly mayCount?: boolean;
  /** Each id asked about. */
  readonly values: ReadonlyMap<string, R>;
}

/** Where the reads come from: the host's usage read, and its count. */
export interface UsageSource<R, Read extends UsageRead<R> = UsageRead<R>> {
  readonly usage: (
    ids: readonly string[],
    signal: AbortSignal
  ) => Promise<Read>;
  readonly count?: () => Promise<SharedStylesCount>;
}

/**
 * A list of ids as one string an effect or a memo can depend on. JSON, since
 * an id is any string, a newline or a comma included, so no separator could
 * be told apart from an id.
 */
export function idsKey(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

/** The ids a key made by {@link idsKey} holds. */
export function idsOf(key: string): string[] {
  const parsed: unknown = JSON.parse(key);
  return Array.isArray(parsed)
    ? parsed.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * Counting the pages now, offered when the host can and this author may:
 * the way out for a site whose background jobs no scheduler runs.
 */
export interface CountNow {
  readonly busy: boolean;
  /** What the last count found, when it found something to say. */
  readonly said: string | undefined;
  /** Whether a count left pages to count, so the next one goes on. */
  readonly again: boolean;
  /**
   * Whether the last count said no further count can get anywhere: what is
   * left cannot be counted, so none is offered until the counts are read
   * again and say otherwise.
   */
  readonly final: boolean;
  readonly run: () => void;
}

/** The count button's words: what it will do, or that it is doing it. */
export function countNowWords(counter: CountNow): string {
  if (counter.busy) return "Counting…";
  return counter.again ? "Count again" : "Count now";
}

/** Where a count is offered nowhere: what counts the pages, and a link to how. */
export function CountedByJobs(): React.JSX.Element {
  return (
    <p className="nx-vars__note">
      {"Pages are counted by the site's background jobs. "}
      <BackgroundJobsLink />
    </p>
  );
}

/** The link to how the site's background jobs are run. */
export function BackgroundJobsLink(): React.JSX.Element {
  return (
    <a
      className="nx-vars__link"
      href={BACKGROUND_JOBS_DOCS_HREF}
      target="_blank"
      rel="noreferrer"
    >
      How background jobs run
    </a>
  );
}

/** What a count says when what is left cannot be counted at all. */
const CANNOT_COUNT_MORE = "The pages left can't be counted.";

/** What a count that failed with no words of its own says. */
const COUNT_FAILED = "The pages could not be counted.";

/** What a count leaves to say when the pages are not all counted yet. */
const STILL_TO_COUNT = "Some pages are still to count.";

/** What a count found to say, and whether no further count can help. */
interface CountFound {
  readonly said: string;
  readonly again: boolean;
  readonly final?: true;
}

/** What the row says after a count: nothing once every page is counted. */
function countFound(answer: {
  readonly whole: boolean;
  readonly counting: boolean;
}): CountFound | undefined {
  if (answer.whole) return undefined;
  return answer.counting
    ? { said: STILL_TO_COUNT, again: true }
    : { said: CANNOT_COUNT_MORE, again: false, final: true };
}

/**
 * The count, run once at a time: on an answer the rows on screen are read
 * again, so their counts and the notes follow; a refusal says why, and a
 * count that left pages says so and offers the next.
 */
function useCountNow(
  count: (() => Promise<SharedStylesCount>) | undefined,
  mayCount: boolean,
  recountNow: () => void,
  /** The reads so far, and whether the latest say the site is counting. */
  reads: {
    readonly answered: number;
    readonly counting: "yes" | "unknown" | "no";
  }
): CountNow | undefined {
  const [busy, setBusy] = React.useState(false);
  const [found, setFound] = React.useState<
    | (CountFound & {
        /** How many reads had answered when it was said. */
        readonly at: number;
      })
    | undefined
  >(undefined);
  // A final word gives way to a later read that says the site is counting
  // again: something new to count has turned up since the count.
  const stale =
    found?.final === true &&
    reads.answered > found.at &&
    reads.counting === "yes";
  React.useEffect(() => {
    if (stale) setFound(undefined);
  }, [stale]);
  const answeredNow = React.useRef(reads.answered);
  answeredNow.current = reads.answered;
  const run = React.useCallback(() => {
    if (count === undefined || busy) return;
    setBusy(true);
    setFound(undefined);
    count()
      .then(answer => {
        setBusy(false);
        if (answer.kind === "refused") {
          setFound({
            said: answer.reason,
            again: false,
            at: answeredNow.current,
          });
          return;
        }
        recountNow();
        // Another count is offered only when the answer says one would get
        // further: pages left that cannot be counted are not "still to
        // count", whatever the panel last read.
        const said = countFound(answer);
        // Stamped with the reads answered so far. The read the count sets
        // off is not counted as answered, since it can tell this answer
        // nothing newer than itself, so the first other read moves past it.
        setFound(
          said === undefined ? undefined : { ...said, at: answeredNow.current }
        );
      })
      // A host that throws rather than answering a refusal: said all the
      // same, so the button is not left saying it is counting.
      .catch(() => {
        setBusy(false);
        setFound({ said: COUNT_FAILED, again: false, at: answeredNow.current });
      });
  }, [count, busy, recountNow]);
  if (count === undefined || !mayCount) return undefined;
  return {
    busy,
    said: found?.said,
    again: found?.again === true,
    final: found?.final === true,
    run,
  };
}

/** The health an id's usage was read under: its read's `whole` and `counting`. */
interface Reading {
  readonly whole: boolean;
  /** Undefined where the host did not say. */
  readonly counting: boolean | undefined;
}

/**
 * Whether the listed ids' floors are worth asking for again: "yes" when an
 * id read before the count was whole was read while the site was still being
 * counted, "unknown" when such a reading did not say, "no" otherwise. Per id,
 * like {@link wholeOf}, since one scan is several reads and the count can
 * finish between them: a later read saying it is done says nothing of the
 * floors an earlier read left.
 */
function countingOf(
  readings: ReadonlyMap<string, Reading>,
  ids: readonly string[]
): "yes" | "unknown" | "no" {
  const floors = ids.flatMap(id => {
    const reading = readings.get(id);
    return reading === undefined || reading.whole ? [] : [reading.counting];
  });
  if (floors.includes(true)) return "yes";
  return floors.includes(undefined) ? "unknown" : "no";
}

/**
 * Whether the rows on screen are due another read on the recount timer: while
 * their counts are floors the site is still counting, or may be, and fewer
 * than {@link USAGE_RECOUNT_IDLE_MAX} recounts have changed nothing.
 */
function recountDue(args: {
  readable: boolean;
  whole: boolean | undefined;
  counting: "yes" | "unknown" | "no";
  failed: boolean;
  recounts: number;
}): boolean {
  if (!args.readable || args.whole !== false || args.failed) return false;
  return args.counting !== "no" && args.recounts < USAGE_RECOUNT_IDLE_MAX;
}

/**
 * The usage of `ids` as one value, so a recount that moved any of it is told
 * from one that changed nothing. Each id's whole answer, not a summary of
 * it: a page use added as a component use goes keeps the total and changes
 * what the row says. JSON, for the reason {@link idsKey} is.
 */
function progressKey<R>(
  values: ReadonlyMap<string, R>,
  ids: readonly string[]
): string {
  return JSON.stringify(ids.map(id => values.get(id) ?? null));
}

/** What the reads kept: each id's usage, and the health it was read under. */
interface KeptReads<R, Read> {
  readonly values: ReadonlyMap<string, R>;
  /** Per id, the health of the read that counted it. */
  readonly readings: ReadonlyMap<string, Reading>;
  /** The latest read that answered, for what a tab reads beside the counts. */
  readonly latest: Read | undefined;
  readonly mayCount: boolean;
  readonly failed: boolean;
  /** How many reads have answered, so a later one can be told from an earlier. */
  readonly answered: number;
}

/**
 * Whether the counts of `ids` are whole: every one read so far was read under
 * a whole index. Derived per id rather than from the last read, since one
 * scan is several reads and the index can finish counting between them: an
 * earlier read's floors stay floors until that id is read again. Only the
 * ids listed now are asked, so an id since removed cannot hold it false.
 */
function wholeOf(
  readings: ReadonlyMap<string, Reading>,
  ids: readonly string[]
): boolean | undefined {
  const read = ids.flatMap(id => {
    const reading = readings.get(id);
    return reading === undefined ? [] : [reading.whole];
  });
  return read.length === 0 ? undefined : read.every(Boolean);
}

/** Usage for some ids, read at most a read's size at a time, each handed on. */
async function readUsage<R, Read extends UsageRead<R>>(
  source: UsageSource<R, Read>,
  ids: readonly string[],
  signal: AbortSignal,
  onRead: (read: Read) => void
): Promise<void> {
  for (let at = 0; at < ids.length; at += USAGE_READ_SIZE) {
    const read = await source.usage(
      ids.slice(at, at + USAGE_READ_SIZE),
      signal
    );
    if (signal.aborted) return;
    onRead(read);
  }
}

/** One read's answer folded into what the reads kept. */
function mergedReads<R, Read extends UsageRead<R>>(
  current: KeptReads<R, Read>,
  read: Read,
  ownCount = false
): KeptReads<R, Read> {
  return {
    values: new Map([...current.values, ...read.values]),
    readings: new Map([
      ...current.readings,
      ...[...read.values.keys()].map(
        id => [id, { whole: read.whole, counting: read.counting }] as const
      ),
    ]),
    latest: read,
    // Absent from a host written before it existed: no.
    mayCount: read.mayCount === true,
    failed: false,
    // Not a later word for a count when it is the count's own read: a final
    // word is stamped with the reads answered before it, and only another
    // read may move past it, whether or not the count's own ever answers.
    answered: ownCount ? current.answered : current.answered + 1,
  };
}

/**
 * Read some ids' usage into the kept reads, a failure marked; answers the
 * effect's cleanup, which drops a read the effect no longer wants.
 */
function readInto<R, Read extends UsageRead<R>>(
  source: UsageSource<R, Read>,
  ids: readonly string[],
  setState: React.Dispatch<React.SetStateAction<KeptReads<R, Read>>>,
  /** The read a count sets off, which tells the count nothing newer. */
  ownCount = false
): () => void {
  const controller = new AbortController();
  readUsage(source, ids, controller.signal, read =>
    setState(current => mergedReads(current, read, ownCount))
  ).catch(() => {
    if (!controller.signal.aborted) {
      setState(current => ({ ...current, failed: true }));
    }
  });
  return () => controller.abort();
}

/** The usage of the rows on screen, as the reads have answered so far. */
export interface UsageReads<R, Read> {
  /** Each id's usage, once read. */
  readonly values: ReadonlyMap<string, R>;
  /**
   * Whether every listed id's usage was read while every page had been
   * counted. Undefined until a read has answered.
   */
  readonly whole: boolean | undefined;
  /** Whether floors among them may still become whole; see `countingOf`. */
  readonly counting: "yes" | "unknown" | "no";
  /** The latest read that answered, for what a tab reads beside the counts. */
  readonly latest: Read | undefined;
  /** Whether this author may ask for the pages to be counted now. */
  readonly mayCount: boolean;
  readonly failed: boolean;
  /** Ask about these ids again, as after a write the server refused. */
  readonly reread: (ids: readonly string[]) => void;
  /**
   * Ask about these ids again and settle once every answer is kept, for a
   * caller that acts on the fresh answer: a removal judged on counts read
   * earlier. Rejects when a read fails, the counts kept as they were.
   */
  readonly readAgain: (ids: readonly string[]) => Promise<void>;
  /**
   * Counting the pages now, when this author may and the host can; its
   * answer reads the rows on screen again.
   */
  readonly counter: CountNow | undefined;
}

/**
 * The recount timer: while the counts of `ids` are floors and the site may
 * still be counting, a recount each {@link USAGE_RECOUNT_MS}, its budget
 * renewed whenever the counts move. Answers the recount number and a
 * recount now, with the recount a count set off.
 */
function useRecounts<R, Read>(
  readable: boolean,
  state: KeptReads<R, Read>,
  ids: readonly string[],
  whole: boolean | undefined,
  counting: "yes" | "unknown" | "no"
): {
  recount: number;
  recountNow: () => void;
  /** Where the budget runs from, renewed when ids not read before are read. */
  budgetFrom: React.RefObject<number>;
  /** The recount a count set off, so its read is told from every other. */
  countRead: React.RefObject<number | undefined>;
} {
  const [recount, setRecount] = React.useState(0);
  const countRead = React.useRef<number | undefined>(undefined);
  // The recount the budget runs from: renewed whenever ids not read before
  // are read, so an id made after the budget was spent is still asked about
  // again, not only once, and whenever the counts change, so a site still
  // getting on with its counting is asked until it is done.
  const budgetFrom = React.useRef(0);
  const progress = progressKey(state.values, ids);
  const progressSeen = React.useRef(progress);
  // Before the timer's effect, which reads the budget this may renew.
  React.useEffect(() => {
    if (progressSeen.current === progress) return;
    progressSeen.current = progress;
    budgetFrom.current = recount;
  }, [progress, recount]);
  React.useEffect(() => {
    // Only while the site is still being counted, or may be: floors that
    // nothing will make whole (content the index cannot reach) are not asked
    // for again.
    const due = recountDue({
      readable,
      whole,
      counting,
      failed: state.failed,
      recounts: recount - budgetFrom.current,
    });
    if (!due) return;
    const timer = setTimeout(
      () => setRecount(count => count + 1),
      USAGE_RECOUNT_MS
    );
    return () => clearTimeout(timer);
  }, [readable, whole, counting, state, recount]);
  // A recount now, its budget renewed: the author just asked for the pages
  // to be counted, so what follows is worth following again.
  const latest = React.useRef(recount);
  latest.current = recount;
  const recountNow = React.useCallback(() => {
    const next = latest.current + 1;
    countRead.current = next;
    budgetFrom.current = next;
    setRecount(next);
  }, []);
  return { recount, recountNow, budgetFrom, countRead };
}

/**
 * How widely the rows on screen are used: each id is read once, at most a
 * read's size at a time, as rows come on screen; a row already read is not
 * asked again while the counts are whole. While some pages are still being
 * counted, every row on screen is asked again each {@link USAGE_RECOUNT_MS},
 * until they are.
 *
 * `source` is read by identity, so a host's adapter around its access is
 * memoised by the caller.
 */
export function useUsageReads<R, Read extends UsageRead<R>>(
  source: UsageSource<R, Read> | undefined,
  ids: readonly string[]
): UsageReads<R, Read> {
  const [state, setState] = React.useState<KeptReads<R, Read>>({
    values: new Map(),
    readings: new Map(),
    latest: undefined,
    mayCount: false,
    failed: false,
    answered: 0,
  });
  const known = React.useRef(state.values);
  known.current = state.values;
  const key = idsKey(ids);
  const whole = wholeOf(state.readings, ids);
  const counting = countingOf(state.readings, ids);
  const { recount, recountNow, budgetFrom, countRead } = useRecounts(
    source !== undefined,
    state,
    ids,
    whole,
    counting
  );
  const recounted = React.useRef(recount);
  React.useEffect(() => {
    if (source === undefined) return;
    // A recount asks for every row on screen; otherwise only the rows that
    // have come on screen since the last read.
    const again = recounted.current !== recount;
    recounted.current = recount;
    // An empty id names nothing, and the routes refuse one.
    const unread = idsOf(key).filter(
      id => id !== "" && (again || !known.current.has(id))
    );
    if (unread.length === 0) return;
    if (!again) budgetFrom.current = recount;
    return readInto(
      source,
      unread,
      setState,
      again && recount === countRead.current
    );
  }, [source, key, recount, budgetFrom, countRead]);
  // Ids asked about again on their own, after a write the server refused.
  const [asked, reread] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    if (source === undefined || asked.length === 0) return;
    return readInto(source, asked, setState);
  }, [source, asked]);
  const readAgain = React.useCallback(
    async (ids: readonly string[]): Promise<void> => {
      if (source === undefined) return;
      // Not dropped with the view: what it settles is the caller's to use.
      await readUsage(source, ids, new AbortController().signal, read =>
        setState(current => mergedReads(current, read))
      );
    },
    [source]
  );
  const counter = useCountNow(source?.count, state.mayCount, recountNow, {
    answered: state.answered,
    counting,
  });
  return {
    values: state.values,
    whole,
    counting,
    latest: state.latest,
    mayCount: state.mayCount,
    failed: state.failed,
    reread,
    readAgain,
    counter,
  };
}
