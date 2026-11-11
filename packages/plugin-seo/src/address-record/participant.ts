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
 * catch-up at start) take turns. SQLite runs one writer at a time, so it
 * takes no locks.
 *
 * @module address-record/participant
 */
import { createHash } from "node:crypto";

import {
  NextlyError,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type ParticipantTransaction,
  type PluginContext,
  type PublicAddressParticipant,
} from "@nextlyhq/plugin-sdk";

import { redirectsSlug } from "../redirects/collection";
import { movedRedirect } from "../redirects/moves";
import { dropReplacedRedirect, putRedirect } from "../redirects/store";

import { ADDRESS_RECORD_SLUG } from "./collection";

/** What a row of the record is. */
type RowKind = "address" | "range" | "lock";

/** A row of the record, read back. */
export interface RecordRow {
  id: string;
  kind: RowKind;
  address: HeldAddress | null;
  holder: AddressHolder | null;
}

type Transaction = ParticipantTransaction["transaction"];

/** How many rows one read takes. */
const READ_PAGE = 200;

/** The SHA-256 of `text`, the same on every dialect. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The stored claim key of an address, range or path lock row. */
export function claimKey(
  kind: RowKind,
  locale: string,
  path: string
): string {
  return sha256(`${kind}:${locale}|${path}`);
}

/** The claim key of a page's own lock row. */
function holderLockKey(holder: AddressHolder): string {
  return sha256(`lock:holder|${holder.collection}:${holder.id}`);
}

/** The kind of row an address is kept as. */
function kindOf(address: HeldAddress): RowKind {
  return address.range === true ? "range" : "address";
}

/** Every path above `path`, root first, the root itself included. */
export function pathsAbove(path: string): string[] {
  if (path === "/") return [];
  const segments = path.split("/").filter(segment => segment !== "");
  const above = ["/"];
  for (let at = 1; at < segments.length; at++) {
    above.push(`/${segments.slice(0, at).join("/")}`);
  }
  return above;
}

/** Whether `path` is `range` or below it. */
function within(path: string, range: string): boolean {
  if (path === range) return true;
  return path.startsWith(range === "/" ? "/" : `${range}/`);
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

/** A stored row read back, every column checked rather than trusted. */
export function rowOf(entry: unknown): RecordRow {
  const row = entry as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const locale = text(row.locale);
  const path = text(row.path);
  const kind: RowKind =
    row.kind === "address" || row.kind === "range" ? row.kind : "lock";
  const collection = text(row.holderCollection);
  const id = text(row.holderId);
  const label = text(row.holderLabel);
  return {
    id: String(row.id),
    kind,
    address:
      locale === null || path === null
        ? null
        : { locale, path, ...(kind === "range" ? { range: true } : {}) },
    holder:
      collection === null || id === null
        ? null
        : { collection, id, ...(label ? { label } : {}) },
  };
}

/**
 * The record's slug as this site has it: the plugin's own, or the name the
 * site renamed it to with the plugin's `rename`.
 */
export function recordSlug(ctx: PluginContext): string {
  return ctx.self.collections[ADDRESS_RECORD_SLUG] ?? ADDRESS_RECORD_SLUG;
}

/**
 * Let go of every address a deleted collection's entries held, inside the
 * delete's own transaction: a collection deleted whole removes its entries
 * without a save of each, so no save would release them, and an address left
 * held by a document that no longer exists could never be taken again.
 */
export function releaseOnCollectionDelete(ctx: PluginContext): void {
  const record = recordSlug(ctx);
  ctx.hooks.onCollectionDelete({
    inTransaction: async ({ slug, transaction }) => {
      for (;;) {
        const { data } =
          await ctx.services.ownCollections.listEntriesInTransaction(
            transaction,
            record,
            {
              where: { holderCollection: { equals: slug } },
              pagination: { limit: READ_PAGE, page: 1 },
              depth: 0,
            },
            { lock: "update" }
          );
        const rows = (data as unknown[]).map(rowOf);
        for (const row of rows) {
          await ctx.services.collections.deleteEntryInTransaction(
            transaction,
            record,
            row.id
          );
        }
        // Each page is deleted before the next is read, so page 1 again.
        if (rows.length < READ_PAGE) return;
      }
    },
  });
}

/** Reading and locking the record's rows on a transaction. */
function recordRows(ctx: PluginContext) {
  const slug = recordSlug(ctx);
  const collections = ctx.services.collections;
  const reads = ctx.services.ownCollections;

  /** Every row `where` selects, read on the save's transaction. */
  async function rowsWhere(
    transaction: Transaction,
    where: Record<string, unknown>,
    lock: "share" | "update" | "none"
  ): Promise<RecordRow[]> {
    const found: RecordRow[] = [];
    for (let page = 1; ; page++) {
      const { data } = await reads.listEntriesInTransaction(
        transaction,
        slug,
        {
          where,
          pagination: { limit: READ_PAGE, page },
          sort: { field: "claimKey", direction: "asc" },
          depth: 0,
        },
        { lock }
      );
      const rows = (data as unknown[]).map(rowOf);
      found.push(...rows);
      // A short page ends the read: the total beside it is an unlocked count.
      if (rows.length < READ_PAGE) return found;
    }
  }

  /**
   * Hold the lock row `key` until the transaction ends: read for update where
   * it exists, made with `fields` where it does not (a save making it at the
   * same moment waits on the key's index), and written, which is the lock.
   */
  async function holdLock(
    transaction: Transaction,
    key: string,
    fields: { locale: string; path: string }
  ): Promise<void> {
    const byKey = { claimKey: { equals: key } };
    let [row] = await rowsWhere(transaction, byKey, "update");
    if (row === undefined) {
      try {
        await collections.createEntryInTransaction(transaction, slug, {
          claimKey: key,
          kind: "lock",
          ...fields,
        });
        return;
      } catch (error) {
        if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      }
      [row] = await rowsWhere(transaction, byKey, "update");
      if (row === undefined) {
        throw NextlyError.internal({
          logContext: { reason: "address-lock-vanished", ...fields },
        });
      }
    }
    await collections.updateEntryInTransaction(transaction, slug, row.id, {
      kind: "lock",
      _overwrite: true,
    });
  }

  /** Hold `holder`'s own lock row until the transaction ends. */
  function holdHolderLock(
    transaction: Transaction,
    holder: AddressHolder
  ): Promise<void> {
    return holdLock(transaction, holderLockKey(holder), {
      locale: "",
      path: `${holder.collection}:${holder.id}`,
    });
  }

  /**
   * The addresses and ranges `holder` keeps, read for update, or with no row
   * lock (`none`) where the page's own lock already keeps them from changing.
   */
  async function rowsOf(
    transaction: Transaction,
    holder: AddressHolder,
    lock: "update" | "none" = "update"
  ): Promise<RecordRow[]> {
    return rowsWhere(
      transaction,
      {
        and: [
          { kind: { in: ["address", "range"] } },
          { holderCollection: { equals: holder.collection } },
          { holderId: { equals: holder.id } },
        ],
      },
      lock
    );
  }

  return { slug, rowsWhere, holdLock, holdHolderLock, rowsOf };
}

/**
 * What the record says `holder` holds now, read on `transaction` with the
 * page's own lock held until it ends: a save of the page waits for it, so
 * what is read cannot change before the transaction's own writes.
 *
 * The rows themselves are read with no row lock. Every write to a page's rows
 * takes the page's lock first, so none can change them meanwhile, and a lock
 * on them here, before the path locks a move takes next, would invert the
 * order a save of another page takes them in: path locks, then the rows.
 */
export async function heldNow(
  ctx: PluginContext,
  transaction: Transaction,
  holder: AddressHolder
): Promise<HeldAddress[]> {
  const rows = recordRows(ctx);
  if (ctx.dialect !== "sqlite") await rows.holdHolderLock(transaction, holder);
  return (await rows.rowsOf(transaction, holder, "none")).flatMap(row =>
    row.address === null ? [] : [row.address]
  );
}

/** The participant, bound to the SEO plugin's context. */
export function addressRecord(ctx: PluginContext): PublicAddressParticipant {
  const { slug, rowsWhere, holdLock, holdHolderLock, rowsOf } = recordRows(ctx);
  const collections = ctx.services.collections;
  const redirects = redirectsSlug(ctx);
  /** Whether `holder` is a redirect, holding its From address. */
  const isRedirect = (holder: AddressHolder) =>
    holder.collection === redirects;

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
    if (asked.range !== true) {
      if (isRedirect(holder) && held.range === true) return false;
      return overlaps(held, asked);
    }
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
    transaction: Transaction,
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
      if (holder !== undefined) await holdHolderLock(transaction, holder);
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
        await holdLock(transaction, claimKey("lock", at.locale, at.path), at);
      }
    }
  }

  /** The held rows `asked` could meet: at it or above it, or below a range. */
  async function rowsMeeting(
    transaction: Transaction,
    asked: HeldAddress
  ): Promise<RecordRow[]> {
    const held = { kind: { in: ["address", "range"] } };
    const inLocale = { locale: { equals: asked.locale } };
    // The address itself, held exactly or as a range, and every range above
    // it, found through the unique claim key's index rather than a scan of
    // the language's addresses.
    const keys = [
      claimKey("address", asked.locale, asked.path),
      ...[asked.path, ...pathsAbove(asked.path)].map(path =>
        claimKey("range", asked.locale, path)
      ),
    ];
    const atOrAbove = await rowsWhere(
      transaction,
      { claimKey: { in: keys } },
      "share"
    );
    if (asked.range !== true) return atOrAbove;
    // `contains` matches the text literally on every dialect (a `like` there
    // would read `_` and `%` as wildcards), and anywhere in the path, so the
    // rows it finds are only candidates; `overlaps` keeps those truly below.
    const below = await rowsWhere(
      transaction,
      {
        and: [
          held,
          inLocale,
          { path: { contains: asked.path === "/" ? "/" : `${asked.path}/` } },
        ],
      },
      "share"
    );
    return [...atOrAbove, ...below];
  }

  /**
   * Delete the rows `holder` keeps that `holds` no longer has; answer the
   * keys of the rest, and the addresses let go.
   */
  async function release(
    transaction: Transaction,
    update: HeldAddressUpdate
  ): Promise<{ still: Set<string>; released: HeldAddress[] }> {
    const wanted = new Set(
      update.holds.map(h => claimKey(kindOf(h), h.locale, h.path))
    );
    const rows = await rowsOf(transaction, update.holder);
    const still = new Set<string>();
    const released: HeldAddress[] = [];
    for (const row of rows) {
      const key = row.address
        ? claimKey(row.kind, row.address.locale, row.address.path)
        : "";
      if (wanted.has(key)) {
        still.add(key);
        continue;
      }
      await collections.deleteEntryInTransaction(transaction, slug, row.id);
      if (row.address) released.push(row.address);
    }
    return { still, released };
  }

  /** Write `held` for `update.holder`, refused by the key where another holds it. */
  async function claim(
    transaction: Transaction,
    update: HeldAddressUpdate,
    held: HeldAddress
  ): Promise<void> {
    const key = claimKey(kindOf(held), held.locale, held.path);
    if (!isRedirect(update.holder)) {
      // A published page taking a redirect's From address replaces the
      // redirect: the page is meant to live there now.
      const [taken] = await rowsWhere(
        transaction,
        { claimKey: { equals: key } },
        "update"
      );
      if (taken?.holder && isRedirect(taken.holder)) {
        await collections.deleteEntryInTransaction(transaction, slug, taken.id);
        await dropReplacedRedirect(ctx, transaction, taken.holder.id);
      }
    }
    try {
      await collections.createEntryInTransaction(transaction, slug, {
        claimKey: key,
        kind: kindOf(held),
        locale: held.locale,
        path: held.path,
        holderCollection: update.holder.collection,
        holderId: update.holder.id,
        holderLabel: update.holder.label ?? null,
      });
    } catch (error) {
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      const [other] = await rowsWhere(
        transaction,
        { claimKey: { equals: key } },
        "share"
      );
      // Only the address in the message: the saver may not be allowed to read
      // the page holding it, which the log names instead.
      throw NextlyError.duplicate({
        message: `${held.path} (${held.locale}) is already the address of another page. Choose another address for this entry.`,
        logContext: {
          reason: "public-address-held",
          held,
          holder: update.holder,
          heldBy: other?.holder,
        },
      });
    }
  }

  return {
    async holderOf(asked, asker, batch, { transaction }) {
      await holdLocks(transaction, batch);
      // The batch's holders are judged by what they will hold, not their rows.
      const moving = batch.map(update => update.holder);
      const stored = (await rowsMeeting(transaction, asked)).flatMap(row =>
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

    async record(batch, { transaction }) {
      await holdLocks(transaction, batch);
      // Every release first, so an address passing between holders in one
      // batch is free by the time it is claimed.
      const letGo = new Map<
        HeldAddressUpdate,
        { still: Set<string>; released: HeldAddress[] }
      >();
      for (const update of batch) {
        letGo.set(update, await release(transaction, update));
      }
      for (const update of batch) {
        const kept = letGo.get(update)?.still ?? new Set<string>();
        for (const held of update.holds) {
          if (!kept.has(claimKey(kindOf(held), held.locale, held.path))) {
            await claim(transaction, update, held);
          }
        }
      }
      // Once every claim stands, so a redirect never meets an address the
      // batch is about to take.
      for (const update of batch) {
        const released = letGo.get(update)?.released ?? [];
        if (released.length > 0 && !isRedirect(update.holder)) {
          await redirectReleased(transaction, update, released);
        }
      }
    },
  };
}
