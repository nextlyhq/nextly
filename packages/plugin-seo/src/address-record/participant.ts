/**
 * The SEO plugin's part in keeping each public address to one page: it keeps
 * the site-wide record of who holds which address, answers core's question
 * from it inside every save, and keeps it in step with what each document
 * holds after the save.
 *
 * Two saves of one address never both commit: an address's row has a unique
 * key, and before reading, each call takes the lock row of every page it
 * moves, then those of every path it touches and every path above them, each
 * set in one sorted order, so a range and an address inside it meet on the
 * range's lock row, two saves in several languages never wait on each other
 * in a cycle, and two writes to one page's addresses (a save and the
 * catch-up at start) take turns. A lock row is taken by a one-row update,
 * and what is read after it is read locked, which on MySQL is what reads the
 * latest rows rather than the save's snapshot. SQLite runs one writer at a
 * time, so it takes no locks.
 *
 * The rows live in the plugin's own table (`address-record/store`), written
 * on the save's transaction through the `db` core binds to it.
 *
 * @module address-record/participant
 */
import { AsyncLocalStorage } from "node:async_hooks";

import {
  NextlyError,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type ParticipantTransaction,
  type PluginContext,
  type PluginTransaction,
  type PublicAddressParticipant,
} from "@nextlyhq/plugin-sdk";

import { redirectsSlug } from "../redirects/collection";
import { movedRedirect } from "../redirects/moves";
import { dropReplacedRedirect, putRedirect } from "../redirects/store";
import { SEO_ADMIN_SLUG } from "../settings/contract";

import {
  claimKey,
  keysHolding,
  pathsAbove,
  sha256,
  within,
  type RecordRow,
  type RowKind,
} from "./rows";
import {
  announceRecordChanged,
  deleteRows,
  holdersByKey,
  insertClaim,
  onFlowTransaction,
  recordReady,
  releaseCollection,
  rowsByKeys,
  rowsOfHolder,
  rowsUnder,
  takeLock,
  type RowLock,
} from "./store";

type Transaction = ParticipantTransaction["transaction"];

/** The claim key of a page's own lock row. */
function holderLockKey(holder: AddressHolder): string {
  return sha256(`lock:holder|${holder.collection}:${holder.id}`);
}

/** The kind of row an address is kept as. */
function kindOf(address: HeldAddress): RowKind {
  return address.range === true ? "range" : "address";
}

/**
 * Whether a held address and an asked one meet: the same address, or either
 * a range the other falls in.
 */
function overlaps(held: HeldAddress, asked: HeldAddress): boolean {
  if (held.locale !== asked.locale) return false;
  if (held.path === asked.path) return true;
  return (
    (held.range === true && within(asked.path, held.path)) ||
    (asked.range === true && within(held.path, asked.path))
  );
}

function sameHolder(a: AddressHolder, b: AddressHolder): boolean {
  return a.collection === b.collection && a.id === b.id;
}

/**
 * How a read inside a save locks the rows it reads: none on SQLite, which
 * runs one writer at a time, and `mode` elsewhere.
 */
function lockFor(ctx: PluginContext, mode: Exclude<RowLock, "none">): RowLock {
  return ctx.dialect === "sqlite" ? "none" : mode;
}

/**
 * Let go of every address a deleted collection's entries held, inside the
 * delete's own transaction: a collection deleted whole removes its entries
 * without a save of each, so no save would release them, and an address left
 * held by a document that no longer exists could never be taken again.
 */
export function releaseOnCollectionDelete(ctx: PluginContext): void {
  ctx.hooks.onCollectionDelete({
    inTransaction: async ({ slug }) => {
      await recordReady(ctx);
      // On the delete's transaction, which the flow is in.
      const released = await onFlowTransaction(ctx, db =>
        releaseCollection(db, slug)
      );
      if (released > 0) announceRecordChanged(ctx);
    },
  });
}

/**
 * Hold the lock row `key` until `db`'s transaction ends. SQLite runs one
 * writer at a time, so there none is taken.
 */
async function holdLock(
  ctx: PluginContext,
  db: PluginTransaction,
  key: string,
  fields: { locale: string; path: string }
): Promise<void> {
  if (ctx.dialect !== "sqlite") await takeLock(ctx, db, key, fields);
}

/** Hold `holder`'s own lock row until `db`'s transaction ends. */
function holdHolderLock(
  ctx: PluginContext,
  db: PluginTransaction,
  holder: AddressHolder
): Promise<void> {
  return holdLock(ctx, db, holderLockKey(holder), {
    locale: "",
    path: `${holder.collection}:${holder.id}`,
  });
}

/**
 * What the record says `holder` holds now, read on the transaction the
 * calling flow is in (`_transaction` stands for it) with the page's own lock
 * held until it ends: a save of the page waits for it, so what is read
 * cannot change before the transaction's own writes.
 *
 * Every write to a page's rows takes the page's lock first, so none can
 * change them meanwhile. They are read with a share lock all the same, which
 * reads the latest rows on MySQL, where a plain read answers from the
 * transaction's snapshot; a share lock keeps no other save's read waiting,
 * and only a save replacing a redirect writes rows it does not hold.
 */
export async function heldNow(
  ctx: PluginContext,
  _transaction: Transaction,
  holder: AddressHolder
): Promise<HeldAddress[]> {
  await recordReady(ctx);
  return onFlowTransaction(ctx, async db => {
    await holdHolderLock(ctx, db, holder);
    return (await rowsOfHolder(db, holder, lockFor(ctx, "share"))).flatMap(
      row => (row.address === null ? [] : [row.address])
    );
  });
}

/**
 * Who holds each of `paths` in `locale`, read for all of them at once while
 * `work` runs: `addressHolders` asked about one of them in `locale` answers
 * from this read, so a list of pages worked through one by one costs one read
 * of the record rather than one a page. Any other address is read as before.
 */
export async function withAddressHolders<T>(
  ctx: PluginContext,
  locale: string,
  paths: readonly string[],
  work: () => Promise<T>
): Promise<T> {
  const keysByPath = new Map(
    paths.map(path => [path, keysHolding(locale, path)])
  );
  const allKeys = [...new Set([...keysByPath.values()].flat())];
  const holderByKey = await holdersByKey(ctx, allKeys);
  const known = new Map<string, AddressHolder[]>();
  for (const [path, keys] of keysByPath) {
    known.set(
      `${locale}|${path}`,
      keys.flatMap(claim => holderByKey.get(claim) ?? [])
    );
  }
  return holdersKnown.run(known, work);
}

/** The holders a `withAddressHolders` read found, while its work runs. */
const holdersKnown = new AsyncLocalStorage<Map<string, AddressHolder[]>>();

/**
 * Who the record says holds the address `path` in `locale`, or in the site's
 * default language where the route named none: the page holding it exactly,
 * or holding a range it falls in, read by the rows' unique keys, so a page
 * that still holds `path` in another language is never taken for its holder
 * here. None where no page holds it, as before the record has caught up with
 * a site's content.
 */
export async function addressHolders(
  ctx: PluginContext,
  path: string,
  locale: string | undefined
): Promise<AddressHolder[]> {
  const language = locale ?? (await ctx.publicAddresses.defaultLanguage());
  const known = holdersKnown.getStore()?.get(`${language}|${path}`);
  if (known !== undefined) return known;
  return [...(await holdersByKey(ctx, keysHolding(language, path))).values()];
}

/** What one page's addresses became in a recorded batch. */
export interface AddressMove {
  /** The addresses it held before and holds no more. */
  released: readonly HeldAddress[];
  /** Every address it holds now. */
  holds: readonly HeldAddress[];
}

/**
 * The event the record announces each page's addresses on, once a batch of
 * saves it recorded has committed: every page, never a redirect. Never for
 * a save that was undone, since the event waits for the save's transaction.
 */
export const ADDRESSES_MOVED: string = `${SEO_ADMIN_SLUG}.addresses-moved`;

/** The payload `ADDRESSES_MOVED` carries. */
export interface AddressesMoved {
  moves: readonly AddressMove[];
}

/**
 * Announce `moves` once the save that recorded them commits. Announcing
 * never fails the save: whatever goes wrong only costs the announcement.
 */
function announceMoves(
  ctx: PluginContext,
  moves: readonly AddressMove[]
): void {
  if (moves.length === 0) return;
  try {
    const payload: AddressesMoved = { moves };
    ctx.events.emit(ADDRESSES_MOVED, payload);
  } catch (error) {
    ctx.logger.warn("The SEO plugin could not announce moved addresses", {
      error,
    });
  }
}

/**
 * The event the record announces, once a batch of saves it recorded has
 * committed, where any redirect's From address was claimed or let go of:
 * what the Proxy's kept redirect addresses are dropped on. Never for a save
 * that was undone.
 */
export const REDIRECTS_CHANGED: string = `${SEO_ADMIN_SLUG}.redirects-changed`;

/**
 * Announce that redirects changed, where any of `holders` is a redirect, once
 * the save commits; never failing it.
 */
function announceRedirectsChanged(
  ctx: PluginContext,
  holders: readonly AddressHolder[],
  isRedirect: (holder: AddressHolder) => boolean
): void {
  if (!holders.some(isRedirect)) return;
  try {
    ctx.events.emit(REDIRECTS_CHANGED, {});
  } catch (error) {
    ctx.logger.warn("The SEO plugin could not announce changed redirects", {
      error,
    });
  }
}

/** The participant, bound to the SEO plugin's context. */
export function addressRecord(ctx: PluginContext): PublicAddressParticipant {
  const redirects = redirectsSlug(ctx);
  /** Whether `holder` is a redirect, holding its From address. */
  const isRedirect = (holder: AddressHolder) => holder.collection === redirects;

  /**
   * Whether `held`, held by `holder`, keeps `asker` from holding `asked`.
   *
   * A page is kept off an address another page holds, and never off one a
   * redirect holds: it replaces that redirect. A redirect is kept off an
   * address a page holds, exactly or in a range above it, and off another
   * redirect's same From address; a pattern above an exact address does not
   * keep it off, since an exact redirect answers first. A pattern is kept off
   * only by the same pattern, or by a page's range covering all of it: a page
   * at an address inside a pattern is served, and the pattern redirects the
   * rest.
   */
  function keepsOff(
    holder: AddressHolder,
    held: HeldAddress,
    asker: AddressHolder,
    asked: HeldAddress
  ): boolean {
    if (!isRedirect(asker)) return !isRedirect(holder) && overlaps(held, asked);
    return asked.range === true
      ? keepsPatternOff(holder, held, asked)
      : !(isRedirect(holder) && held.range === true) && overlaps(held, asked);
  }

  /** Whether `held`, held by `holder`, keeps a pattern redirect off `asked`. */
  function keepsPatternOff(
    holder: AddressHolder,
    held: HeldAddress,
    asked: HeldAddress
  ): boolean {
    if (held.range !== true || held.locale !== asked.locale) return false;
    if (held.path === asked.path) return true;
    return !isRedirect(holder) && within(asked.path, held.path);
  }

  /**
   * Leave a permanent redirect from each address `update`'s page let go of
   * to the address it holds now in the same language, as a save of a moved
   * page would want. None where the page holds nothing in that language now,
   * or where another page holds the old address once every claim stands: the
   * redirect's own claim is refused there, which is also why two pages
   * swapping addresses in one batch make none. A
   * redirect that cannot be saved fails the save, naming the address, so the
   * page keeps its old one.
   */
  async function redirectReleased(
    transaction: Transaction,
    update: HeldAddressUpdate,
    released: readonly HeldAddress[]
  ): Promise<void> {
    for (const old of released) {
      const input = movedRedirect(old, update.holds);
      if (input === undefined) continue;
      let outcome: Awaited<ReturnType<typeof putRedirect>>;
      try {
        outcome = await putRedirect(ctx, transaction, input);
      } catch (error) {
        throw NextlyError.conflict({
          reason: "state",
          message: `The old address ${old.path} (${old.locale}) could not be kept as a redirect, so the address was not changed. Try again, or remove the redirects that point to it first.`,
          cause: error instanceof Error ? error : undefined,
          logContext: {
            reason: "automatic-redirect-failed",
            old,
            input,
            holder: update.holder,
          },
        });
      }
      // Refused only where another page serves the old address, which then
      // needs no redirect, or where the address cannot be one.
      if ("refused" in outcome && outcome.reason !== "held") {
        ctx.logger.warn("A moved page's old address was given no redirect", {
          old,
          input,
          holder: update.holder,
          refused: outcome.refused,
        });
      }
    }
  }

  /**
   * Take the lock rows of every address in `batch` and every path above each,
   * in one sorted order, before any of them is read.
   */
  async function holdLocks(
    db: PluginTransaction,
    batch: readonly HeldAddressUpdate[]
  ): Promise<void> {
    if (ctx.dialect === "sqlite") return;
    // Each page's own lock first, every caller in the same order, so a write
    // holding a page's lock never waits on one holding a path's for it.
    const holders = new Map(
      batch.map(update => [holderLockKey(update.holder), update.holder])
    );
    for (const key of [...holders.keys()].sort()) {
      const holder = holders.get(key);
      if (holder !== undefined) await holdHolderLock(ctx, db, holder);
    }
    const keys = new Map<string, { locale: string; path: string }>();
    for (const update of batch) {
      for (const held of update.holds) {
        for (const path of [...pathsAbove(held.path), held.path]) {
          keys.set(`${held.locale}|${path}`, { locale: held.locale, path });
        }
      }
    }
    // Plain code-unit order, the same in every process, whatever its locale.
    for (const key of [...keys.keys()].sort()) {
      const at = keys.get(key);
      if (at !== undefined) {
        await holdLock(ctx, db, claimKey("lock", at.locale, at.path), at);
      }
    }
  }

  /** The held rows `asked` could meet: at it or above it, or below a range. */
  async function rowsMeeting(
    db: PluginTransaction,
    asked: HeldAddress
  ): Promise<RecordRow[]> {
    // Read with a share lock, which reads the latest rows: on MySQL a plain
    // read here answers from the snapshot the save's first read took, which
    // misses a save this one waited for on a lock row.
    const lock = lockFor(ctx, "share");
    // The address itself, held exactly or as a range, and every range above
    // it, found through the unique claim key's index rather than a scan of
    // the language's addresses.
    const atOrAbove = await rowsByKeys(
      db,
      keysHolding(asked.locale, asked.path),
      lock
    );
    if (asked.range !== true) return atOrAbove;
    // Candidates only: `overlaps` keeps those truly below.
    const below = await rowsUnder(
      db,
      asked.locale,
      asked.path === "/" ? "/" : `${asked.path}/`,
      lock
    );
    return [...atOrAbove, ...below];
  }

  /**
   * Delete the rows `holder` keeps that `holds` no longer has; answer the
   * keys of the rest, and the addresses let go.
   */
  async function release(
    db: PluginTransaction,
    update: HeldAddressUpdate
  ): Promise<{ still: Set<string>; released: HeldAddress[] }> {
    const wanted = new Set(
      update.holds.map(h => claimKey(kindOf(h), h.locale, h.path))
    );
    const rows = await rowsOfHolder(db, update.holder, lockFor(ctx, "update"));
    const still = new Set<string>();
    const released: HeldAddress[] = [];
    const gone: string[] = [];
    for (const row of rows) {
      const key = row.address
        ? claimKey(row.kind, row.address.locale, row.address.path)
        : "";
      if (wanted.has(key)) {
        still.add(key);
        continue;
      }
      gone.push(row.id);
      if (row.address) released.push(row.address);
    }
    // One statement for every row let go of.
    await deleteRows(db, gone);
    return { still, released };
  }

  /**
   * Claim every address `update` holds that `kept` does not already;
   * answers how many were claimed.
   */
  async function claimNew(
    db: PluginTransaction,
    transaction: Transaction,
    update: HeldAddressUpdate,
    kept: ReadonlySet<string> = new Set()
  ): Promise<number> {
    let claimed = 0;
    for (const held of update.holds) {
      if (!kept.has(claimKey(kindOf(held), held.locale, held.path))) {
        await claim(db, transaction, update, held);
        claimed += 1;
      }
    }
    return claimed;
  }

  /** Write `held` for `update.holder`, refused by the key where another holds it. */
  async function claim(
    db: PluginTransaction,
    transaction: Transaction,
    update: HeldAddressUpdate,
    held: HeldAddress
  ): Promise<void> {
    const key = claimKey(kindOf(held), held.locale, held.path);
    if (!isRedirect(update.holder)) {
      // A published page taking a redirect's From address replaces the
      // redirect: the page is meant to live there now.
      const [taken] = await rowsByKeys(db, [key], lockFor(ctx, "update"));
      if (taken?.holder && isRedirect(taken.holder)) {
        await deleteRows(db, [taken.id]);
        await dropReplacedRedirect(ctx, transaction, taken.holder.id);
      }
    }
    if (await insertClaim(ctx, db, key, held, update.holder)) return;
    // Only the address in the message: the saver may not be allowed to read
    // the page holding it. The key refused the row, which on PostgreSQL ends
    // the transaction, so nothing more is read on it.
    throw NextlyError.duplicate({
      message: `${held.path} (${held.locale}) is already the address of another page. Choose another address for this entry.`,
      logContext: {
        reason: "public-address-held",
        held,
        holder: update.holder,
      },
    });
  }

  return {
    async holderOf(asked, asker, batch, { db }) {
      await recordReady(ctx);
      await holdLocks(db, batch);
      // The batch's holders are judged by what they will hold, not their rows.
      const moving = batch.map(update => update.holder);
      const stored = (await rowsMeeting(db, asked)).flatMap(row =>
        row.address &&
        row.holder &&
        !moving.some(holder => sameHolder(holder, row.holder as AddressHolder))
          ? [{ address: row.address, holder: row.holder }]
          : []
      );
      const coming = batch.flatMap(update =>
        update.holds.map(address => ({ address, holder: update.holder }))
      );
      const found = [...stored, ...coming].find(
        candidate =>
          !sameHolder(candidate.holder, asker) &&
          keepsOff(candidate.holder, candidate.address, asker, asked)
      );
      return found?.holder ?? null;
    },

    async record(batch, { db, transaction }) {
      await recordReady(ctx);
      await holdLocks(db, batch);
      // Every release first, so an address passing between holders in one
      // batch is free by the time it is claimed.
      const letGo = new Map<
        HeldAddressUpdate,
        { still: Set<string>; released: HeldAddress[] }
      >();
      let changed = 0;
      for (const update of batch) {
        const outcome = await release(db, update);
        letGo.set(update, outcome);
        changed += outcome.released.length;
      }
      for (const update of batch) {
        changed += await claimNew(
          db,
          transaction,
          update,
          letGo.get(update)?.still
        );
      }
      // Page heads read who holds an address, so they expire once a change
      // to it commits; a save that changed nothing expires none.
      if (changed > 0) announceRecordChanged(ctx);
      // Once every claim stands, so a redirect never meets an address the
      // batch is about to take.
      for (const update of batch) {
        const released = letGo.get(update)?.released ?? [];
        if (released.length > 0 && !isRedirect(update.holder)) {
          await redirectReleased(transaction, update, released);
        }
      }
      announceRedirectsChanged(
        ctx,
        batch.map(update => update.holder),
        isRedirect
      );
      announceMoves(
        ctx,
        batch
          .filter(update => !isRedirect(update.holder))
          .map(update => ({
            released: letGo.get(update)?.released ?? [],
            holds: update.holds,
          }))
      );
    },
  };
}
