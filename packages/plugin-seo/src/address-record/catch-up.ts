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

const NOTHING: CatchUpReport = { ran: false, recorded: 0, lost: [] };

/** The last catch-up started, and the context it ran with. */
let started: { ctx: PluginContext; run: Promise<CatchUpReport> } | undefined;

/**
 * Start a catch-up for the SEO plugin's context `ctx`, not awaited by the
 * caller: it waits for the boot to finish, and logs rather than throws.
 */
export function startCatchUp(ctx: PluginContext): Promise<CatchUpReport> {
  const run = caughtUp(ctx);
  started = { ctx, run };
  return run;
}

/** How many catch-ups are under way. */
let running = 0;
/** Whether the last catch-up to finish failed, leaving the record behind. */
let failed = false;

/**
 * Whether the record says what each page holds: no catch-up is under way,
 * and the last one to finish succeeded. An output that lists addresses from
 * the record answers as not ready otherwise.
 */
export function addressRecordReady(): boolean {
  return running === 0 && !failed;
}

/**
 * Start the catch-up again, not awaited, where the last one failed and none
 * is under way: a failure from a passing cause is not left in place until
 * the next start.
 */
export function retryFailedCatchUp(): void {
  if (failed && running === 0 && started !== undefined) void catchUp();
}

/** The last catch-up started, to wait for. */
export function lastCatchUp(): Promise<CatchUpReport> | undefined {
  return started?.run;
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
  const run = caughtUp(started.ctx, options);
  started = { ctx: started.ctx, run };
  return run;
}

async function caughtUp(
  ctx: PluginContext,
  options: CatchUpOptions = {}
): Promise<CatchUpReport> {
  running += 1;
  try {
    const report = await runCatchUp(ctx, options);
    failed = false;
    if (report.lost.length > 0) await problemsOutOfDate(ctx);
    return report;
  } catch (error) {
    failed = true;
    ctx.logger.error("The SEO address record could not be brought up to date", {
      error,
    });
    return NOTHING;
  } finally {
    running -= 1;
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

/**
 * Every page of every site type, oldest first across all of them, by when
 * each was made; pages made at the same moment keep the order listed.
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
  else if (outcome.refused.length === 0) expected.set(key, [...update.holds]);
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
  lost: LostAddress[]
): Promise<boolean> {
  let holds = [...update.holds];
  for (;;) {
    const outcome = await moveIfCurrent(ctx, { ...update, holds }, expected);
    if (outcome === "overtaken") return false;
    const first = outcome.refused[0];
    if (first === undefined) {
      if (holds.length === 0 || (await stillExists(ctx, update.holder))) {
        return true;
      }
      await moveIfCurrent(ctx, { holder: update.holder, holds: [] }, expected);
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
 * rest; answers what each page kept.
 */
async function keepWhatStands(
  ctx: PluginContext,
  pages: readonly HeldAddressUpdate[],
  was: ReadonlyMap<string, { holds: HeldAddress[] }>,
  expected: Expected
): Promise<Map<string, HeldAddress[]>> {
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
 * page) is that plugin's to judge.
 */
async function letGoOfTheGone(
  ctx: PluginContext,
  was: ReadonlyMap<string, { holder: AddressHolder }>,
  kept: ReadonlyMap<string, unknown>,
  expected: Expected,
  types: { now: ReadonlySet<string>; before: ReadonlySet<string> }
): Promise<void> {
  for (const [key, entry] of was) {
    if (kept.has(key)) continue;
    const { collection } = entry.holder;
    const removed = types.before.has(collection) && !types.now.has(collection);
    const gone =
      removed ||
      (types.now.has(collection) && (await entryIsGone(ctx, entry.holder)));
    if (gone) {
      await moveIfCurrent(ctx, { holder: entry.holder, holds: [] }, expected);
    }
  }
}

/** Pass 2: every page claims what it newly holds, oldest first. */
async function claimTheNew(
  ctx: PluginContext,
  pages: readonly HeldAddressUpdate[],
  kept: ReadonlyMap<string, HeldAddress[]>,
  expected: Expected
): Promise<{ recorded: number; lost: LostAddress[] }> {
  let recorded = 0;
  const lost: LostAddress[] = [];
  for (const page of pages) {
    const keep = kept.get(holderKey(page.holder)) ?? [];
    if (page.holds.length === keep.length) continue;
    if (await claim(ctx, page, expected, lost)) recorded += 1;
  }
  for (const each of lost) {
    ctx.logger.warn(
      "A page lost its public address to the page already holding it",
      { address: each.address, page: each.holder, heldBy: each.heldBy }
    );
  }
  return { recorded, lost };
}

/**
 * Make the redirects every page's move owes, this start's and any an earlier
 * start left owing, each to where the record says the page is now. Each
 * owed move is forgotten once its redirect is made or refused.
 */
async function redirectOwedMoves(ctx: PluginContext): Promise<void> {
  const owed = new Map<string, PendingMove[]>();
  for (const move of await pendingMoves(ctx)) {
    const key = holderKey(move.holder);
    owed.set(key, [...(owed.get(key) ?? []), move]);
  }
  for (const moves of owed.values()) {
    const [first] = moves;
    if (first === undefined) continue;
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
  }
}

async function runCatchUp(
  ctx: PluginContext,
  options: CatchUpOptions
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
  const kept = await keepWhatStands(ctx, pages, was, expected);
  await letGoOfTheGone(ctx, was, kept, expected, {
    now: new Set(siteTypes),
    before: typesIn(stored.siteTypes),
  });
  // The redirects that process saved or removed, once every page has let go
  // of what it no longer holds: a redirect from a page's old address claims
  // it only after the page lets it go.
  const redirects =
    earlier === undefined
      ? { settled: true }
      : await reclaimRedirectAddresses(ctx);
  await options.afterReleases?.();
  const { recorded, lost } = await claimTheNew(ctx, pages, kept, expected);
  await redirectOwedMoves(ctx);
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
  return { ran: true, recorded, lost };
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
