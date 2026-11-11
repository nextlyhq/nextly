/**
 * The SEO plugin's part in keeping each public address to one page: it keeps
 * the site-wide record of who holds which address, answers core's question
 * from it inside every save, and keeps it in step with what each document
 * holds after the save.
 *
 * Two saves of one address never both commit: an address's row has a unique
 * key, and before reading, each call takes the lock rows of every path it
 * touches and every path above them, in one sorted order, so a range and an
 * address inside it meet on the range's lock row, and two saves in several
 * languages never wait on each other in a cycle. SQLite runs one writer at a
 * time, so it takes no locks.
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

import { ADDRESS_RECORD_SLUG } from "./collection";

/** What a row of the record is. */
type RowKind = "address" | "range" | "lock";

/** A row of the record, read back. */
interface RecordRow {
  id: string;
  kind: RowKind;
  address: HeldAddress | null;
  holder: AddressHolder | null;
}

type Transaction = ParticipantTransaction["transaction"];

/** How many rows one read takes. */
const READ_PAGE = 200;

/** The stored claim key: the SHA-256 of its text, the same on every dialect. */
function claimKey(kind: RowKind, locale: string, path: string): string {
  return createHash("sha256")
    .update(`${kind}:${locale}|${path}`, "utf8")
    .digest("hex");
}

/** The kind of row an address is kept as. */
function kindOf(address: HeldAddress): RowKind {
  return address.range === true ? "range" : "address";
}

/** Every path above `path`, root first, the root itself included. */
function pathsAbove(path: string): string[] {
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
function rowOf(entry: unknown): RecordRow {
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

/** How a refusal names the page already holding an address. */
function named(holder: AddressHolder | null | undefined): string {
  if (!holder) return "another page";
  const who = holder.label ? `"${holder.label}"` : `the entry ${holder.id}`;
  return `${who} in ${holder.collection}`;
}

/** The participant, bound to the SEO plugin's context. */
export function addressRecord(ctx: PluginContext): PublicAddressParticipant {
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
        ADDRESS_RECORD_SLUG,
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
   * Hold the lock row of `path` in `locale` until the save ends: read for
   * update where it exists, made where it does not (a save making it at the
   * same moment waits on the key's index), and written, which is the lock.
   */
  async function holdLock(
    transaction: Transaction,
    locale: string,
    path: string
  ): Promise<void> {
    const key = claimKey("lock", locale, path);
    const byKey = { claimKey: { equals: key } };
    let [row] = await rowsWhere(transaction, byKey, "update");
    if (row === undefined) {
      try {
        await collections.createEntryInTransaction(
          transaction,
          ADDRESS_RECORD_SLUG,
          { claimKey: key, kind: "lock", locale, path }
        );
        return;
      } catch (error) {
        if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      }
      [row] = await rowsWhere(transaction, byKey, "update");
      if (row === undefined) {
        throw NextlyError.internal({
          logContext: { reason: "address-lock-vanished", locale, path },
        });
      }
    }
    await collections.updateEntryInTransaction(
      transaction,
      ADDRESS_RECORD_SLUG,
      row.id,
      { kind: "lock", _overwrite: true }
    );
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
      if (at !== undefined) await holdLock(transaction, at.locale, at.path);
    }
  }

  /** The held rows `asked` could meet: at it or above it, or below a range. */
  async function rowsMeeting(
    transaction: Transaction,
    asked: HeldAddress
  ): Promise<RecordRow[]> {
    const held = { kind: { in: ["address", "range"] } };
    const inLocale = { locale: { equals: asked.locale } };
    const atOrAbove = await rowsWhere(
      transaction,
      {
        and: [
          held,
          inLocale,
          { path: { in: [asked.path, ...pathsAbove(asked.path)] } },
        ],
      },
      "share"
    );
    if (asked.range !== true) return atOrAbove;
    // `like` matches anywhere, and its wildcards are not escaped, so the
    // rows it finds are only candidates; `overlaps` keeps those truly below.
    const below = await rowsWhere(
      transaction,
      {
        and: [
          held,
          inLocale,
          { path: { like: asked.path === "/" ? "/" : `${asked.path}/` } },
        ],
      },
      "share"
    );
    return [...atOrAbove, ...below];
  }

  /** Delete the rows `holder` keeps that `holds` no longer has; answer the rest. */
  async function release(
    transaction: Transaction,
    update: HeldAddressUpdate
  ): Promise<Set<string>> {
    const wanted = new Set(
      update.holds.map(h => claimKey(kindOf(h), h.locale, h.path))
    );
    const rows = await rowsWhere(
      transaction,
      {
        and: [
          { kind: { in: ["address", "range"] } },
          { holderCollection: { equals: update.holder.collection } },
          { holderId: { equals: update.holder.id } },
        ],
      },
      "update"
    );
    const still = new Set<string>();
    for (const row of rows) {
      const key = row.address
        ? claimKey(row.kind, row.address.locale, row.address.path)
        : "";
      if (wanted.has(key)) {
        still.add(key);
        continue;
      }
      await collections.deleteEntryInTransaction(
        transaction,
        ADDRESS_RECORD_SLUG,
        row.id
      );
    }
    return still;
  }

  /** Write `held` for `update.holder`, refused by the key where another holds it. */
  async function claim(
    transaction: Transaction,
    update: HeldAddressUpdate,
    held: HeldAddress
  ): Promise<void> {
    const key = claimKey(kindOf(held), held.locale, held.path);
    try {
      await collections.createEntryInTransaction(
        transaction,
        ADDRESS_RECORD_SLUG,
        {
          claimKey: key,
          kind: kindOf(held),
          locale: held.locale,
          path: held.path,
          holderCollection: update.holder.collection,
          holderId: update.holder.id,
          holderLabel: update.holder.label ?? null,
        }
      );
    } catch (error) {
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      const [other] = await rowsWhere(
        transaction,
        { claimKey: { equals: key } },
        "share"
      );
      throw NextlyError.duplicate({
        message: `${held.path} (${held.locale}) is already the address of ${named(other?.holder)}. Choose another address for this entry.`,
        logContext: {
          reason: "public-address-held",
          held,
          holder: update.holder,
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
          overlaps(candidate.address, asked)
      );
      return found?.holder ?? null;
    },

    async record(batch, { transaction }) {
      await holdLocks(transaction, batch);
      // Every release first, so an address passing between holders in one
      // batch is free by the time it is claimed.
      const still = new Map<HeldAddressUpdate, Set<string>>();
      for (const update of batch) {
        still.set(update, await release(transaction, update));
      }
      for (const update of batch) {
        const kept = still.get(update) ?? new Set<string>();
        for (const held of update.holds) {
          if (!kept.has(claimKey(kindOf(held), held.locale, held.path))) {
            await claim(transaction, update, held);
          }
        }
      }
    },
  };
}
