/**
 * Bringing the SEO plugin's address record up to date at start, without any
 * save: a site that had content before the plugin arrived, or whose addresses
 * a deploy moved, is recorded as its pages now stand.
 *
 * It runs only where the fingerprint core gives of every address template
 * and site type differs from the one stored at the last run, where no run has
 * finished (a new or dropped record stores none), where a deploy move is
 * still owed its redirect, or where a process still running the earlier
 * version that kept the record in a collection wrote that collection since
 * the record last took it in (`earlierWritesSince`): the pages and redirects
 * that process saved are recorded as they now stand, and the moves it noted
 * are owed their redirects here. It works in two passes so a deploy that
 * moves one page off an address and another onto it is no clash:
 *
 * 1. every page keeps the addresses it already holds and still resolves to,
 *    and lets go of the rest; a page that no longer exists lets go of all;
 * 2. every page then claims what it newly holds, oldest first. One whose new
 *    address another page holds is left without it, and listed.
 *
 * The page already holding an address keeps it, newer or not: content never
 * takes the site down, and visitors keep reaching what they reached before.
 *
 * Once every claim stands, each address a page let go of leaves a permanent
 * redirect to the page's new one, as a save would: an old address another
 * page now holds is refused rather than used as a step to a third page, and
 * a page that lost its new address gets none. The route has already moved,
 * so a redirect that cannot be saved lists the old address as a broken link.
 * The fingerprint is stored last, so a start interrupted part-way runs the
 * whole catch-up again.
 *
 * A run may be stopped part-way, between one page and the next, and resumed
 * by the next: each page's change commits on a transaction of its own, so
 * what a stopped run did stands in the record, and the next run, reading the
 * record afresh, finds those pages already where they belong and moves only
 * the rest. A request that cannot answer without the record runs the catch-up
 * itself, awaited and stopped by its own deadline
 * (`addressRecordReadyWithin`): on a serverless platform a function is frozen
 * once it has answered, and work it did not wait for is frozen with it, a
 * transaction open at that moment ended by the database before it runs again.
 *
 * Saves go on while it runs, so what it read can be overtaken. Each page's
 * record is changed only where it still says what the catch-up read, checked
 * under the page's own lock on the transaction that changes it: a save that
 * got there first is newer, and the page is left as that save recorded it.
 *
 * @module address-record/catch-up
 */
import {
  NextlyError,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type HeldDocument,
  type ParticipantTransaction,
  type PluginContext,
  type PluginTransactionBounds,
} from "@nextlyhq/plugin-sdk";

import { markOutOfDate } from "../problems/store";
import { redirectDeployMove } from "../redirects/moves";
import { reclaimRedirectAddresses } from "../redirects/reclaim";

import { heldNow } from "./participant";
import {
  forgetPending,
  keepPending,
  pendingMoves,
  type PendingMove,
} from "./pending-moves";
import type { RecordRow } from "./rows";
import {
  EARLIER_NOTE_KEYS,
  forgetNotes,
  earlierWritesSince,
  type EarlierShape,
  heldRows,
  keepEarlierShape,
  noteKey,
  putNote,
  readNotes,
  takeEarlierPending,
} from "./store";

type Transaction = ParticipantTransaction["transaction"];

/** A page left without an address another page holds. */
export interface LostAddress {
  holder: AddressHolder;
  address: HeldAddress;
  heldBy: AddressHolder;
}

/** What a catch-up did. */
export interface CatchUpReport {
  /** Whether it ran, rather than finding the record current. */
  ran: boolean;
  /**
   * Whether the record is up to date once it is done: false where it failed,
   * or stopped part-way for the next run to go on with.
   */
  finished: boolean;
  /** How many pages claimed addresses they newly hold. */
  recorded: number;
  lost: LostAddress[];
}

/** The key of the note that stores the fingerprint of the last run. */
const FINGERPRINT_KEY = noteKey("fingerprint");

/**
 * The key of the note that stores which types were the site's at the last
 * run, so a holder of a type since removed is told apart from a plugin's own.
 */
const SITE_TYPES_KEY = noteKey("site-types");

/** How many rows or pages one read takes. */
const PAGE = 200;

/** A run that found the record current. */
const NOTHING: CatchUpReport = {
  ran: false,
  finished: true,
  recorded: 0,
  lost: [],
};

/** A run that failed. */
const FAILED: CatchUpReport = {
  ran: false,
  finished: false,
  recorded: 0,
  lost: [],
};

/**
 * The bounds each transaction a catch-up opens is given
 * (`ctx.db.withTransactionBounds`).
 */
export const CATCH_UP_TRANSACTION_BOUNDS: Readonly<PluginTransactionBounds> = {
  // Long enough for a save holding a page's lock to finish; past it, the
  // holder is taken to be stuck, and the catch-up fails and is tried again.
  lockWaitMs: 2000,
  // A catch-up sends its statements one after another, so a transaction of
  // its own idle this long belongs to a process that has stopped running.
  idleMs: 5000,
};

/**
 * How old a failed catch-up's start must be before a request tries the
 * catch-up again (`addressRecordReadyWithin`). Counted from its start, not
 * its failure: a run frozen with a transaction open fails only once its
 * function runs again, long after it started, and is tried again at once;
 * one failing at its first statement, as on a database that is down, is not
 * tried again by every request that comes meanwhile.
 */
export const RETRY_FAILED_AFTER_MS = 10_000;

/**
 * How long a request that cannot answer without the record waits for it
 * (`addressRecordReadyWithin`), running the catch-up itself where it is
 * behind. A server just started finds the stored fingerprint current in a
 * read or two; a real catch-up still going past this is answered "come
 * back", or from a copy kept before.
 */
export const RECORD_WAIT_MS = 5000;

/** A catch-up started, the context it runs with, and how it is going. */
interface StartedRun {
  ctx: PluginContext;
  run: Promise<CatchUpReport>;
  /** When it started, by the clock. */
  at: number;
  /**
   * When it stops, part-way, at the next page: a request's deadline for the
   * run that request runs; never for one started at a start.
   */
  stopAt: number;
  /** Whether it has settled. */
  settled: boolean;
}

/** The last catch-up started. */
let started: StartedRun | undefined;

/** Start a catch-up as `startCatchUp` and `catchUp` do. */
function begin(
  ctx: PluginContext,
  options: CatchUpOptions = {},
  stopAt = Number.POSITIVE_INFINITY
): Promise<CatchUpReport> {
  const run: StartedRun = {
    ctx,
    run: Promise.resolve(NOTHING),
    at: Date.now(),
    stopAt,
    settled: false,
  };
  started = run;
  run.run = caughtUp(run, options);
  return run.run;
}

/**
 * Start a catch-up for the SEO plugin's context `ctx`, not awaited by the
 * caller: it waits for the boot to finish, and logs rather than throws.
 */
export function startCatchUp(ctx: PluginContext): Promise<CatchUpReport> {
  return begin(ctx);
}

/** How many catch-ups are under way. */
let running = 0;
/**
 * Where the last catch-up to finish left the record behind: it failed, or
 * it stopped part-way (`unfinished`); when it started, by the clock.
 */
let behind: { why: "failed" | "unfinished"; startedAt: number } | undefined;

/**
 * Whether the record says what each page holds: no catch-up is under way,
 * and the last one to finish brought the record up to date. An output that
 * lists addresses from the record answers as not ready otherwise.
 */
export function addressRecordReady(): boolean {
  return running === 0 && behind === undefined;
}

/** Whether the record is behind and a request may run the catch-up again. */
function nextRunDue(): boolean {
  if (behind === undefined) return false;
  return (
    behind.why === "unfinished" ||
    Date.now() - behind.startedAt >= RETRY_FAILED_AFTER_MS
  );
}

/** The last catch-up started, to wait for. */
export function lastCatchUp(): Promise<CatchUpReport> | undefined {
  return started?.run;
}

/**
 * Whether the record is ready within `ms`, for an answer that cannot be
 * given without it. It waits, never past `ms`, for the catch-up under way,
 * as on a server that has only just started, where the start's run finds the
 * stored fingerprint current with a read or two. Where the record is behind,
 * it runs the catch-up itself, awaited, stopped part-way once `ms` is up:
 * a run that failed, once its start is `RETRY_FAILED_AFTER_MS` old, and one
 * that stopped part-way, at once, going on from what that one left. A run it
 * waits for but did not start is never stopped: it may be a long-running
 * server's whole catch-up. One it started has settled when it answers, so
 * no transaction of the catch-up is left open when the answer is sent.
 */
export async function addressRecordReadyWithin(ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (addressRecordReady()) return true;
    const last = started;
    // Never started, so nothing to wait for or run with.
    if (last === undefined) return false;
    if (!last.settled) {
      const left = deadline - Date.now();
      if (left <= 0 || !(await settlesWithin(last.run, left))) return false;
      continue;
    }
    // Settled and still not ready: behind, and run again only where due
    // and while the wait lasts.
    if (!nextRunDue() || Date.now() >= deadline) return false;
    await begin(last.ctx, {}, deadline);
  }
}

/** Whether `run` settles within `ms`, the timer cleared either way. */
async function settlesWithin(
  run: Promise<unknown>,
  ms: number
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<boolean>(resolve => {
    timer = setTimeout(resolve, ms, false);
  });
  try {
    return await Promise.race([run.then(() => true), limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What a catch-up may be told to do along the way. `afterListing` runs once
 * every page has been read and before any is recorded: the moment a save may
 * land between the two, which a caller can stand in for.
 */
interface CatchUpOptions {
  afterListing?: () => Promise<void>;
  /**
   * Runs once every page has let go of what it no longer holds and before
   * any claims anew: the moment a save may move a page the catch-up moved.
   */
  afterReleases?: () => Promise<void>;
  /**
   * How many pages one listing read takes, and what runs between reads,
   * told the pages listed so far.
   */
  pageSize?: number;
  betweenPages?: (listed: readonly HeldDocument[]) => Promise<void>;
  /**
   * How far from the earlier collection's newest write its shape must be
   * read to be trusted (`earlierWritesSince`); the module's own where unset.
   */
  settleMs?: number;
  /**
   * Whether the run stops before its next step, unfinished: asked before
   * each page's change. Where unset, once the run's deadline has passed and
   * it has changed the record.
   */
  stopNow?: () => boolean;
}

/**
 * Forget the fingerprint of the last catch-up, so the next start runs the
 * whole of it whatever else it finds. For an install, and an uninstall that
 * keeps the plugin's tables: between the two the plugin is not running, so
 * pages saved meanwhile are in no record, and nothing the fingerprint covers
 * (the address templates, languages and site types) need have changed to say
 * so.
 */
export async function forgetCatchUpFingerprint(
  ctx: PluginContext
): Promise<void> {
  await forgetNotes(ctx, [FINGERPRINT_KEY]);
}

/** Run the catch-up again with the last context, as the next start would. */
export async function catchUp(
  options: CatchUpOptions = {}
): Promise<CatchUpReport> {
  if (started === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "address-catch-up-never-started" },
    });
  }
  await started.run;
  return begin(started.ctx, options);
}

async function caughtUp(
  run: StartedRun,
  options: CatchUpOptions
): Promise<CatchUpReport> {
  const { ctx } = run;
  // Past the run's deadline, it stops before its next change, but only once
  // it has moved the record on: every run moves it by at least a page, so
  // requests whose deadline the listing alone outlasts still finish it, and
  // a page refused its address again, which changes nothing, never uses up
  // a run.
  let movedOn = false;
  const steps: Steps = {
    stopNow: options.stopNow ?? (() => movedOn && Date.now() >= run.stopAt),
    moved: () => {
      movedOn = true;
    },
  };
  running += 1;
  try {
    // Every transaction it opens bounded by the database: a run started at a
    // start is not awaited, so on a serverless platform its function may be
    // frozen with one open, and every save of a page and every other
    // catch-up would otherwise wait on that transaction's lock rows until
    // the function ran again.
    const report = await ctx.db.withTransactionBounds(
      CATCH_UP_TRANSACTION_BOUNDS,
      async () => {
        const done = await runCatchUp(ctx, options, steps);
        if (done.lost.length > 0) await problemsOutOfDate(ctx);
        return done;
      }
    );
    behind = report.finished
      ? undefined
      : { why: "unfinished", startedAt: run.at };
    return report;
  } catch (error) {
    behind = { why: "failed", startedAt: run.at };
    ctx.logger.error("The SEO address record could not be brought up to date", {
      error,
    });
    return FAILED;
  } finally {
    running -= 1;
    run.settled = true;
  }
}

const holderKey = (holder: AddressHolder) =>
  `${holder.collection}:${holder.id}`;

const sameAddress = (a: HeldAddress, b: HeldAddress) =>
  a.locale === b.locale && a.path === b.path && a.range === b.range;

/**
 * Say the SEO Problems list's last full check may no longer hold, never
 * failing the catch-up: a page left without the address another holds is
 * listed by the next full check, and until then the list says it is out of
 * date.
 */
async function problemsOutOfDate(ctx: PluginContext): Promise<void> {
  try {
    await markOutOfDate(ctx);
  } catch (error) {
    ctx.logger.warn("The SEO Problems list could not be marked out of date", {
      error,
    });
  }
}

/**
 * The stored fingerprint and site-types notes, found by their keys, whether
 * any deploy move is still owed its redirect, and the notes of the earlier
 * record's move: one read.
 */
async function storedGate(ctx: PluginContext): Promise<{
  fingerprint?: string;
  siteTypes?: string;
  pending: boolean;
  notes: ReadonlyMap<string, string | null>;
}> {
  const { notes, pending } = await readNotes(
    ctx,
    [FINGERPRINT_KEY, SITE_TYPES_KEY, ...EARLIER_NOTE_KEYS],
    true
  );
  return {
    fingerprint: notes.get(FINGERPRINT_KEY) ?? undefined,
    siteTypes: notes.get(SITE_TYPES_KEY) ?? undefined,
    pending,
    notes,
  };
}

/** How a run is told when to stop, and tells what it has changed. */
interface Steps {
  /** Whether the run is to stop before its next change, unfinished. */
  stopNow(): boolean;
  /** Says a change has reached the record, moving it on. */
  moved(): void;
}

/** What a step answers where the run stopped before it was done. */
const STOPPED = "stopped";

/**
 * Every page of every site type, oldest first across all of them, by when
 * each was made; pages made at the same moment keep the order listed. Read
 * whole, never stopped part-way: a run stopped here would leave nothing done
 * for the next to go on from.
 */
async function everyPage(
  ctx: PluginContext,
  options: CatchUpOptions
): Promise<HeldDocument[]> {
  const updates: HeldDocument[] = [];
  for (const type of await ctx.publicAddresses.types()) {
    let after: string | undefined;
    do {
      const page = await ctx.publicAddresses.held({
        type,
        after,
        limit: options.pageSize ?? PAGE,
      });
      updates.push(...page.items);
      after = page.next;
      if (after !== undefined) await options.betweenPages?.(updates);
    } while (after !== undefined);
  }
  const madeAt = (page: HeldDocument) =>
    page.createdAt === undefined
      ? Number.POSITIVE_INFINITY
      : Date.parse(page.createdAt);
  // Array sort is stable, so a tie keeps the listing's own order.
  return updates.sort((a, b) => madeAt(a) - madeAt(b));
}

/**
 * What the catch-up expects the record to say each page holds: what it read,
 * then what each of its own changes left. A page a save overtook is dropped,
 * and left alone from then on.
 */
type Expected = Map<string, HeldAddress[]>;

const sameHolds = (a: readonly HeldAddress[], b: readonly HeldAddress[]) =>
  a.length === b.length &&
  a.every(held => b.some(other => sameAddress(held, other)));

/**
 * Make `update` on a transaction of its own, asking every participant, where
 * the record still says the page holds what `expected` does: checked under
 * the page's lock on the same transaction, so a save cannot land between the
 * check and the change. Answers what was refused, or `overtaken` where a save
 * changed the page first.
 */
async function moveIfCurrent(
  ctx: PluginContext,
  update: HeldAddressUpdate,
  expected: Expected,
  steps: Steps,
  alongside?: (transaction: Transaction) => Promise<void>
): Promise<
  { refused: { address: HeldAddress; heldBy: AddressHolder }[] } | "overtaken"
> {
  const key = holderKey(update.holder);
  const before = expected.get(key);
  if (before === undefined) return "overtaken";
  const outcome = await ctx.services.collections.withTransaction(
    async transaction => {
      const now = await heldNow(ctx, transaction, update.holder);
      if (!sameHolds(now, before)) return "overtaken" as const;
      const moved = await ctx.publicAddresses.move([update], transaction);
      if (moved.refused.length === 0) await alongside?.(transaction);
      return moved;
    }
  );
  if (outcome === "overtaken") expected.delete(key);
  else if (outcome.refused.length === 0) {
    // A change only where the page now holds other than it did: one asked
    // to hold what it already holds moves nothing on.
    if (!sameHolds(before, update.holds)) steps.moved();
    expected.set(key, [...update.holds]);
  }
  return outcome;
}

/**
 * Claim `update`'s addresses, giving up each one another page holds; nothing
 * once a save has overtaken the page. Answers whether anything was claimed.
 *
 * A page deleted since it was listed keeps nothing: its delete let go of
 * what it held before this claim, so once the claim has committed the page is
 * looked up, and a page found gone lets go again. The lookup is made after
 * the claim's transaction, never inside it, so it never waits for a
 * connection the transaction holds. A delete still running when the claim is
 * made waits for the page's lock and lets go of the claim itself.
 */
async function claim(
  ctx: PluginContext,
  update: HeldAddressUpdate,
  expected: Expected,
  lost: LostAddress[],
  steps: Steps
): Promise<boolean> {
  let holds = [...update.holds];
  for (;;) {
    const outcome = await moveIfCurrent(
      ctx,
      { ...update, holds },
      expected,
      steps
    );
    if (outcome === "overtaken") return false;
    const first = outcome.refused[0];
    if (first === undefined) {
      if (holds.length === 0 || (await stillExists(ctx, update.holder))) {
        return true;
      }
      await moveIfCurrent(
        ctx,
        { holder: update.holder, holds: [] },
        expected,
        steps
      );
      return false;
    }
    lost.push({
      holder: update.holder,
      address: first.address,
      heldBy: first.heldBy,
    });
    holds = holds.filter(held => !sameAddress(held, first.address));
  }
}

/** What each holder the record names holds now, by holder key. */
function heldBefore(
  rows: readonly RecordRow[]
): Map<string, { holder: AddressHolder; holds: HeldAddress[] }> {
  const was = new Map<
    string,
    { holder: AddressHolder; holds: HeldAddress[] }
  >();
  for (const row of rows) {
    if (row.holder === null || row.address === null) continue;
    const key = holderKey(row.holder);
    const entry = was.get(key) ?? { holder: row.holder, holds: [] };
    entry.holds.push(row.address);
    was.set(key, entry);
  }
  return was;
}

/**
 * Pass 1: every page keeps what it held and still holds, and lets go of the
 * rest; answers what each page kept, or `STOPPED` where the run stops before
 * a page's change. The pages changed before it stand, and the next run finds
 * them keeping what they hold.
 */
async function keepWhatStands(
  ctx: PluginContext,
  pages: readonly HeldAddressUpdate[],
  was: ReadonlyMap<string, { holds: HeldAddress[] }>,
  expected: Expected,
  steps: Steps
): Promise<Map<string, HeldAddress[]> | typeof STOPPED> {
  const kept = new Map<string, HeldAddress[]>();
  for (const page of pages) {
    const key = holderKey(page.holder);
    const before = was.get(key)?.holds ?? [];
    if (!expected.has(key)) expected.set(key, [...before]);
    const keep = page.holds.filter(held =>
      before.some(b => sameAddress(b, held))
    );
    kept.set(key, keep);
    if (keep.length !== before.length) {
      if (steps.stopNow()) return STOPPED;
      // The route has moved with the deploy: each address let go of is kept
      // on the same transaction, owed a redirect to the page's new one once
      // every claim stands.
      const released = before.filter(
        b => !keep.some(held => sameAddress(b, held))
      );
      await moveIfCurrent(
        ctx,
        { holder: page.holder, holds: keep },
        expected,
        steps,
        transaction => keepPending(ctx, transaction, page.holder, released)
      );
    }
  }
  return kept;
}

/** The holder collection each of the site's types records its pages under. */
async function siteTypeKeys(ctx: PluginContext): Promise<string[]> {
  return (await ctx.publicAddresses.types())
    .map(type => (type.kind === "single" ? `single:${type.slug}` : type.slug))
    .sort();
}

/** The site types a stored note names; none where it names nothing usable. */
function typesIn(value: string | undefined): Set<string> {
  if (value === undefined) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((each): each is string => typeof each === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

/**
 * Whether the page `holder` names still exists. A Single is listed whole
 * and cannot be deleted, so one listed exists; an entry is looked up.
 */
async function stillExists(
  ctx: PluginContext,
  holder: AddressHolder
): Promise<boolean> {
  if (holder.collection.startsWith("single:")) return true;
  try {
    await ctx.services.collections.findEntryById(holder.collection, holder.id);
    return true;
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return false;
    throw error;
  }
}

/**
 * Whether the entry `holder` names is gone: found missing, never merely
 * unseen. A listing read in pages can skip an entry when one before it is
 * deleted between reads, and an entry it skipped still holds its addresses.
 * A Single is listed whole, so one not listed has nothing saved.
 */
async function entryIsGone(
  ctx: PluginContext,
  holder: AddressHolder
): Promise<boolean> {
  if (holder.collection.startsWith("single:")) return true;
  try {
    await ctx.services.collections.findEntryById(holder.collection, holder.id);
    return false;
  } catch (error) {
    return NextlyError.isCode(error, "NOT_FOUND");
  }
}

/**
 * A page that no longer exists lets go of everything: one of a site type
 * found gone, and any of a type that was the site's at the last run and is
 * not now, removed or pruned. A holder of any other type (a plugin's own
 * page) is that plugin's to judge. Answers false where the run stops
 * before a page's change.
 */
async function letGoOfTheGone(
  ctx: PluginContext,
  was: ReadonlyMap<string, { holder: AddressHolder }>,
  kept: ReadonlyMap<string, unknown>,
  expected: Expected,
  types: { now: ReadonlySet<string>; before: ReadonlySet<string> },
  steps: Steps
): Promise<boolean> {
  for (const [key, entry] of was) {
    if (kept.has(key)) continue;
    if (steps.stopNow()) return false;
    const { collection } = entry.holder;
    const removed = types.before.has(collection) && !types.now.has(collection);
    const gone =
      removed ||
      (types.now.has(collection) && (await entryIsGone(ctx, entry.holder)));
    if (gone) {
      await moveIfCurrent(
        ctx,
        { holder: entry.holder, holds: [] },
        expected,
        steps
      );
    }
  }
  return true;
}

/**
 * Pass 2: every page claims what it newly holds, oldest first; `finished`
 * false where the run stops before a page's claim. The claims made before it
 * stand, and the next run, oldest first again, finds those pages holding
 * what they claimed and goes on with the rest.
 */
async function claimTheNew(
  ctx: PluginContext,
  pages: readonly HeldAddressUpdate[],
  kept: ReadonlyMap<string, HeldAddress[]>,
  expected: Expected,
  steps: Steps
): Promise<{ recorded: number; lost: LostAddress[]; finished: boolean }> {
  let recorded = 0;
  let finished = true;
  const lost: LostAddress[] = [];
  for (const page of pages) {
    const keep = kept.get(holderKey(page.holder)) ?? [];
    if (page.holds.length === keep.length) continue;
    if (steps.stopNow()) {
      finished = false;
      break;
    }
    if (await claim(ctx, page, expected, lost, steps)) recorded += 1;
  }
  for (const each of lost) {
    ctx.logger.warn(
      "A page lost its public address to the page already holding it",
      { address: each.address, page: each.holder, heldBy: each.heldBy }
    );
  }
  return { recorded, lost, finished };
}

/**
 * Make the redirects every page's move owes, this start's and any an earlier
 * start left owing, each to where the record says the page is now. Each
 * owed move is forgotten once its redirect is made or refused. Answers false
 * where the run stops before one, which stays owed for the next run.
 */
async function redirectOwedMoves(
  ctx: PluginContext,
  steps: Steps
): Promise<boolean> {
  const owed = new Map<string, PendingMove[]>();
  for (const move of await pendingMoves(ctx)) {
    const key = holderKey(move.holder);
    owed.set(key, [...(owed.get(key) ?? []), move]);
  }
  for (const moves of owed.values()) {
    const [first] = moves;
    if (first === undefined) continue;
    if (steps.stopNow()) return false;
    await redirectDeployMove(
      ctx,
      first.holder,
      moves.map(move => move.address),
      transaction => heldNow(ctx, transaction, first.holder)
    );
    await forgetPending(
      ctx,
      moves.map(move => move.key)
    );
    steps.moved();
  }
  return true;
}

/**
 * One run of the catch-up. Where `steps` says so before a change, it stops
 * there, unfinished, and stores no fingerprint: what it changed stands, and
 * the next run, finding the stored notes still behind, goes on from it.
 */
async function runCatchUp(
  ctx: PluginContext,
  options: CatchUpOptions,
  steps: Steps
): Promise<CatchUpReport> {
  const fingerprint = await ctx.publicAddresses.fingerprint();
  // Skipped on its inputs alone, never on what the record holds: a site none
  // of whose pages holds an address keeps only these notes, and would
  // otherwise walk every page at every start. The fingerprint covers every
  // site type by kind and name, so a type added or removed changes it; the
  // site-types row is written beside it in the same run, and one missing
  // means that run never finished. A full uninstall drops the record with
  // both rows, and one that keeps the data forgets the fingerprint, as an
  // install does (`forgetCatchUpFingerprint`), so a reinstall runs the whole
  // catch-up again.
  const stored = await storedGate(ctx);
  const earlier = await earlierWritesSince(ctx, stored.notes, options.settleMs);
  if (earlier === undefined && isCurrent(stored, fingerprint)) return NOTHING;
  if (earlier !== undefined) await beginTakingIn(ctx, earlier);
  const held = await heldRows(ctx);
  const siteTypes = await siteTypeKeys(ctx);
  const pages = await everyPage(ctx, options);
  await options.afterListing?.();
  const was = heldBefore(held);
  const expected: Expected = new Map(
    [...was].map(([key, entry]) => [key, [...entry.holds]])
  );
  const kept = await keepWhatStands(ctx, pages, was, expected, steps);
  if (kept === STOPPED) return unfinished(0, []);
  const letGo = await letGoOfTheGone(
    ctx,
    was,
    kept,
    expected,
    { now: new Set(siteTypes), before: typesIn(stored.siteTypes) },
    steps
  );
  if (!letGo) return unfinished(0, []);
  // The redirects that process saved or removed, once every page has let go
  // of what it no longer holds: a redirect from a page's old address claims
  // it only after the page lets it go.
  const redirects =
    earlier === undefined
      ? { settled: true }
      : await reclaimRedirectAddresses(ctx);
  await options.afterReleases?.();
  const { recorded, lost, finished } = await claimTheNew(
    ctx,
    pages,
    kept,
    expected,
    steps
  );
  if (!finished) return unfinished(recorded, lost);
  if (!(await redirectOwedMoves(ctx, steps))) {
    return unfinished(recorded, lost);
  }
  await storeNote(
    ctx,
    stored.siteTypes,
    SITE_TYPES_KEY,
    JSON.stringify(siteTypes)
  );
  // Stored last: a start interrupted before this point runs it all again.
  await storeNote(ctx, stored.fingerprint, FINGERPRINT_KEY, fingerprint);
  // And the earlier collection's shape after it, as it was read before the
  // run began: a start interrupted before it, or a run that could not settle
  // every redirect, finds the same writes again, and takes them in again.
  if (earlier !== undefined && redirects.settled) {
    await keepEarlierShape(ctx, earlier);
  }
  return { ran: true, finished: true, recorded, lost };
}

/** The report of a run that stopped part-way. */
function unfinished(recorded: number, lost: LostAddress[]): CatchUpReport {
  return { ran: true, finished: false, recorded, lost };
}

/**
 * Whether the stored notes say the record is current for `fingerprint`: the
 * same fingerprint, the site types kept beside it by a run that finished,
 * and no deploy move still owed its redirect.
 */
function isCurrent(
  stored: Awaited<ReturnType<typeof storedGate>>,
  fingerprint: string
): boolean {
  return (
    stored.fingerprint === fingerprint &&
    stored.siteTypes !== undefined &&
    !stored.pending
  );
}

/**
 * Begin taking in what a process of the earlier version wrote: say so, and
 * note here the moves it noted there, before the run, which makes their
 * redirects with its own.
 */
async function beginTakingIn(
  ctx: PluginContext,
  earlier: EarlierShape
): Promise<void> {
  ctx.logger.info(
    "The SEO plugin found addresses an earlier version recorded during a deploy, and brings its record up to date from the pages",
    { earlier }
  );
  await takeEarlierPending(ctx);
}

/**
 * Keep `value` in the note `key`. A note already keeping `value` is left
 * alone, so a start where nothing moved writes nothing.
 */
async function storeNote(
  ctx: PluginContext,
  stored: string | undefined,
  key: string,
  value: string
): Promise<void> {
  if (stored !== value) {
    await putNote(ctx, key, value, { absent: stored === undefined });
  }
}
