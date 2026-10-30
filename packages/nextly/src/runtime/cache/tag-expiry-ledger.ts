/**
 * The cache tag expiry ledger: when each cache tag last expired, kept in the
 * site's database so every process and every instance shares it.
 *
 * Next.js expires a tag only inside a request, and only in the instance that
 * serves it. A write made anywhere else (a job, the CLI, a script, a hand-off
 * from a request whose own expiry failed) records its tags here instead, and
 * so does a write made inside a request, so that other instances learn of it.
 * Before serving an entry, nextly's cache handlers ask for the expiries of the
 * tags it carries, by key, and stop serving it if one of them expired after it
 * was stored. Asking by key reads each tag's current row, whatever order the
 * writes committed in, so a late commit can cost a refresh but never a stale
 * read; a cursor over rows "newer than the last look" could pass over one.
 *
 * Times are the database's clock (`databaseNowMs`), never an instance's: two
 * instances whose clocks differ still agree on whether an entry predates an
 * expiry, because every lookup hands back the database's time with its rows.
 * A tag's time is taken when its row is written, after the content write it
 * follows has committed, so an entry made from that content is never older
 * than the expiry that judges it.
 *
 * A database that has not run `nextly migrate` since the table was added has
 * no table yet. The ledger then reports itself unavailable, warning once,
 * rather than failing the write or the read that asked.
 *
 * @module runtime/cache/tag-expiry-ledger
 */
import { createHash } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, asc, inArray, lt, sql, type SQL } from "drizzle-orm";

import { tablePresence } from "../../domains/dashboard/table-presence";
import { databaseNowMs } from "../../domains/limits/store-clock";
import { getNextlyLogger } from "../../observability/logger";
import {
  CACHE_TAG_EXPIRIES_TABLE,
  cacheTagExpiriesTables,
} from "../../schemas/cache-tag-expiries";
import { affectedRowCount } from "../../shared/lib/affected-row-count";

/**
 * How long a tag's last expiry is kept. nextly's cache handlers serve no
 * entry stored longer ago than this, so a row pruned past it can no longer
 * make an entry look fresh: every entry it could have expired is already one
 * the handlers refuse by age.
 */
export const LEDGER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** How often the retention pass prunes the ledger. */
export const LEDGER_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Rows removed per statement, and statements per prune by default, so one prune is bounded. */
const PRUNE_BATCH = 1000;
const PRUNE_MAX_BATCHES = 100;

/** Tags asked for per statement, so one lookup's key list stays bounded. */
const LOOKUP_BATCH = 500;

/** The expiries of the tags a lookup asked for. */
export interface TagExpiries {
  /**
   * The database's time when the rows were read, in milliseconds; absent when
   * none of the tags has ever expired, since no row came back to carry it.
   */
  readonly now?: number;
  /** Each asked-for tag that has expired, with when it last did. */
  readonly expired: ReadonlyMap<string, number>;
}

export interface TagExpiryLedger {
  /**
   * Record that `tags` expired now. Resolves `false`, writing nothing, while
   * the table does not exist; throws when the database refuses the write, so a
   * caller that must not lose the tags can keep them.
   */
  record(tags: readonly string[]): Promise<boolean>;
  /**
   * When each of `tags` last expired, read by key, or `undefined` while there
   * is no table.
   */
  expiriesOf(tags: readonly string[]): Promise<TagExpiries | undefined>;
  /**
   * Remove rows that expired more than `maxAgeMs` ago on the database's clock,
   * at most `maxBatches` batches of rows and none once `clock()` reaches
   * `deadline`; returns how many.
   */
  prune(
    maxAgeMs: number,
    options?: { maxBatches?: number; deadline?: number; clock?: () => number }
  ): Promise<number>;
}

/**
 * The adapter surface the ledger uses: its dialect, its query builder and its
 * catalogue lookup. Declared rather than picked from `DrizzleAdapter`, so a
 * caller holding a narrower adapter (a retention pass, a test) can supply it.
 */
export interface TagExpiryLedgerAdapter {
  getCapabilities(): { dialect: SupportedDialect };
  getDrizzle<T>(): T;
  tableExists(table: string): Promise<boolean>;
}

/** A row's id: the tag's SHA-256 in hex, a fixed width every dialect indexes. */
export function tagExpiryId(tag: string): string {
  return createHash("sha256").update(tag).digest("hex");
}

interface LedgerRow {
  tag: string;
  expiredAt: number;
  now: number;
}

/** The query builder surface the ledger uses, whatever the dialect. */
interface LedgerDb {
  select<R>(fields: Record<string, unknown>): {
    from(table: unknown): PromiseLike<R[]> & {
      where(condition: unknown): PromiseLike<R[]> & {
        orderBy(column: unknown): { limit(rows: number): PromiseLike<R[]> };
      };
    };
  };
  insert(table: unknown): {
    values(rows: unknown[]): {
      onConflictDoUpdate(args: unknown): Promise<unknown>;
      onDuplicateKeyUpdate(args: unknown): Promise<unknown>;
    };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/**
 * One ledger per adapter, made on first use: a ledger remembers whether its
 * table exists and that it warned, so every caller sharing it (each retention
 * pass, each scheduled drain) leaves the missing-table warning once-only.
 */
const ledgers = new WeakMap<TagExpiryLedgerAdapter, TagExpiryLedger>();

export function ledgerFor(adapter: TagExpiryLedgerAdapter): TagExpiryLedger {
  let ledger = ledgers.get(adapter);
  if (ledger === undefined) {
    ledger = createTagExpiryLedger(adapter);
    ledgers.set(adapter, ledger);
  }
  return ledger;
}

/** The ledger kept in `adapter`'s database. */
export function createTagExpiryLedger(
  adapter: TagExpiryLedgerAdapter
): TagExpiryLedger {
  const dialect = adapter.getCapabilities().dialect;
  const table = cacheTagExpiriesTables(dialect).nextlyCacheTagExpiries;
  const now: SQL<number> = databaseNowMs(dialect);
  const db = () => adapter.getDrizzle<LedgerDb>();
  const present = tablePresence(
    adapter,
    CACHE_TAG_EXPIRIES_TABLE,
    `the cache tag expiry ledger (${CACHE_TAG_EXPIRIES_TABLE}) does not exist yet, so writes made outside a request, and on other instances, are not seen until it does: run \`nextly migrate\``,
    // Through nextly's logger, which an app may have replaced, read when the
    // warning is issued rather than when the ledger is made.
    {
      warn: (message, context) =>
        getNextlyLogger().warn({
          kind: "cache-tag-ledger-missing",
          message,
          ...context,
        }),
    }
  );

  return {
    async record(tags) {
      const unique = [...new Set(tags)];
      if (unique.length === 0) return true;
      if (!(await present())) return false;
      const insert = db()
        .insert(table)
        .values(
          unique.map(tag => ({ id: tagExpiryId(tag), tag, expiredAt: now }))
        );
      // One statement for every tag: a row that exists moves forward to now.
      if (dialect === "mysql") {
        await insert.onDuplicateKeyUpdate({ set: { expiredAt: now } });
      } else {
        await insert.onConflictDoUpdate({
          target: table.id,
          set: { expiredAt: now },
        });
      }
      return true;
    },

    async expiriesOf(tags) {
      const unique = [...new Set(tags)];
      if (unique.length === 0) return { expired: new Map() };
      if (!(await present())) return undefined;
      const expired = new Map<string, number>();
      let read: number | undefined;
      for (let i = 0; i < unique.length; i += LOOKUP_BATCH) {
        // By primary key, with the database's clock in the same statement.
        const rows = await db()
          .select<LedgerRow>({
            tag: table.tag,
            expiredAt: table.expiredAt,
            now,
          })
          .from(table)
          .where(
            inArray(
              table.id,
              unique.slice(i, i + LOOKUP_BATCH).map(tagExpiryId)
            )
          );
        for (const row of rows) {
          expired.set(row.tag, Number(row.expiredAt));
          read = Number(row.now);
        }
      }
      return { now: read, expired };
    },

    async prune(maxAgeMs, options) {
      if (!(await present())) return 0;
      // On the database's clock, as every row's time is.
      const cutoff = sql<number>`${now} - ${maxAgeMs}`;
      const maxBatches = options?.maxBatches ?? PRUNE_MAX_BATCHES;
      const clock = options?.clock ?? Date.now;
      let removed = 0;
      for (let batch = 0; batch < maxBatches; batch += 1) {
        // Between batches, never inside one: a caller's budget (the scheduled
        // drain's) is not carried past by a whole prune.
        if (options?.deadline !== undefined && clock() >= options.deadline) {
          break;
        }
        // Found through the `expired_at` index, oldest first.
        const ids = (
          await db()
            .select<{ id: string }>({ id: table.id })
            .from(table)
            .where(lt(table.expiredAt, cutoff))
            .orderBy(asc(table.expiredAt))
            .limit(PRUNE_BATCH)
        ).map(row => row.id);
        if (ids.length === 0) break;
        // The cutoff is asked again as each row goes: a tag may have expired
        // again since it was found, and that row must stay.
        const result = await db()
          .delete(table)
          .where(and(inArray(table.id, ids), lt(table.expiredAt, cutoff)));
        removed += affectedRowCount(result, dialect);
        if (ids.length < PRUNE_BATCH) break;
      }
      return removed;
    },
  };
}
