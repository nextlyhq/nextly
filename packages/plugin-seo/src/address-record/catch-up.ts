/**
 * Bringing the SEO plugin's address record up to date at start, without any
 * save: a site that had content before the plugin arrived, or whose addresses
 * a deploy moved, is recorded as its pages now stand.
 *
 * It runs only where the record is empty or the fingerprint core gives of
 * every address template differs from the one stored at the last run, and it
 * works in two passes so a deploy that moves one page off an address and
 * another onto it is no clash:
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
import { createHash } from "node:crypto";

import {
  NextlyError,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type HeldDocument,
  type ParticipantTransaction,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { redirectDeployMove } from "../redirects/moves";

import { heldNow } from "./participant";
import {
  forgetPending,
  keepPending,
  pendingMoves,
  type PendingMove,
} from "./pending-moves";
import { recordSlug, rowOf, type RecordRow } from "./rows";

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

/** The key of the row that stores the fingerprint of the last run. */
const FINGERPRINT_KEY = createHash("sha256")
  .update("meta:fingerprint", "utf8")
  .digest("hex");

/**
 * The key of the row that stores which types were the site's at the last
 * run, so a holder of a type since removed is told apart from a plugin's own.
 */
const SITE_TYPES_KEY = createHash("sha256")
  .update("meta:site-types", "utf8")
  .digest("hex");

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
  try {
    return await runCatchUp(ctx, options);
  } catch (error) {
    ctx.logger.error("The SEO address record could not be brought up to date", {
      error,
    });
    return NOTHING;
  }
}

const holderKey = (holder: AddressHolder) =>
  `${holder.collection}:${holder.id}`;

const sameAddress = (a: HeldAddress, b: HeldAddress) =>
  a.locale === b.locale && a.path === b.path && a.range === b.range;

/** The stored fingerprint row, found by its key: one row read. */
async function storedFingerprint(
  ctx: PluginContext
): Promise<{ id: string; value: unknown } | undefined> {
  const { data } = await ctx.services.ownCollections.listEntries(
    recordSlug(ctx),
    {
      where: { claimKey: { equals: FINGERPRINT_KEY } },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  const [row] = data as Record<string, unknown>[];
  return row === undefined
    ? undefined
    : { id: String(row.id), value: row.path };
}

/** Whether the record holds any address at all: one row read at most. */
async function holdsAny(ctx: PluginContext): Promise<boolean> {
  const { data } = await ctx.services.ownCollections.listEntries(
    recordSlug(ctx),
    {
      where: { kind: { in: ["address", "range"] } },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  return (data as unknown[]).length > 0;
}

/** A stored meta row: its id, and the value it keeps. */
interface MetaRow {
  id: string;
  value: unknown;
}

/**
 * The record's rows: held addresses, the stored fingerprint, and the types
 * that were the site's at the last run.
 */
async function readRecord(ctx: PluginContext): Promise<{
  held: RecordRow[];
  fingerprint?: MetaRow;
  siteTypes?: MetaRow;
}> {
  const held: RecordRow[] = [];
  let fingerprint: MetaRow | undefined;
  let siteTypes: MetaRow | undefined;
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      recordSlug(ctx),
      {
        where: { kind: { in: ["address", "range", "meta"] } },
        pagination: { limit: PAGE, page },
        sort: { field: "claimKey", direction: "asc" },
        depth: 0,
      }
    );
    for (const entry of data as Record<string, unknown>[]) {
      if (entry.claimKey === FINGERPRINT_KEY) {
        fingerprint = { id: String(entry.id), value: entry.path };
      } else if (entry.claimKey === SITE_TYPES_KEY) {
        siteTypes = { id: String(entry.id), value: entry.path };
      } else if (entry.kind !== "meta") {
        held.push(rowOf(entry));
      }
    }
    if ((data as unknown[]).length < PAGE) {
      return { held, fingerprint, siteTypes };
    }
  }
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

/** The site types a stored meta row names; none where it names nothing usable. */
function typesIn(row: MetaRow | undefined): Set<string> {
  if (typeof row?.value !== "string") return new Set();
  try {
    const parsed: unknown = JSON.parse(row.value);
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
  // The stored fingerprint by its key, and whether any address is recorded:
  // an unchanged start reads no more than that.
  const stored = await storedFingerprint(ctx);
  if (
    stored?.value === fingerprint &&
    (await holdsAny(ctx)) &&
    (await pendingMoves(ctx)).length === 0
  ) {
    return NOTHING;
  }
  const record = await readRecord(ctx);
  const siteTypes = await siteTypeKeys(ctx);
  const pages = await everyPage(ctx, options);
  await options.afterListing?.();
  const was = heldBefore(record.held);
  const expected: Expected = new Map(
    [...was].map(([key, entry]) => [key, [...entry.holds]])
  );
  const kept = await keepWhatStands(ctx, pages, was, expected);
  await letGoOfTheGone(ctx, was, kept, expected, {
    now: new Set(siteTypes),
    before: typesIn(record.siteTypes),
  });
  await options.afterReleases?.();
  const { recorded, lost } = await claimTheNew(ctx, pages, kept, expected);
  await redirectOwedMoves(ctx);
  await storeMeta(
    ctx,
    record.siteTypes?.id,
    SITE_TYPES_KEY,
    JSON.stringify(siteTypes)
  );
  // Stored last: a start interrupted before this point runs it all again.
  await storeMeta(ctx, record.fingerprint?.id, FINGERPRINT_KEY, fingerprint);
  return { ran: true, recorded, lost };
}

/** Keep `value` in the meta row `key`, made where it is not there yet. */
async function storeMeta(
  ctx: PluginContext,
  id: string | undefined,
  key: string,
  value: string
): Promise<void> {
  if (id === undefined) {
    await ctx.services.collections.createEntry(recordSlug(ctx), {
      claimKey: key,
      kind: "meta",
      path: value,
    });
    return;
  }
  await ctx.services.collections.updateEntry(recordSlug(ctx), id, {
    path: value,
    _overwrite: true,
  });
}
