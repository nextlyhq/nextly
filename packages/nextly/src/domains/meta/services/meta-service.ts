import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq } from "drizzle-orm";

import { nextlyMeta as nextlyMetaMysql } from "../../../schemas/nextly-meta/mysql";
import { nextlyMeta as nextlyMetaPg } from "../../../schemas/nextly-meta/postgres";
import { nextlyMeta as nextlyMetaSqlite } from "../../../schemas/nextly-meta/sqlite";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";
import { affectedRowCount } from "../../auth/services/auth-service";

/**
 * A key's stored value plus whether the key exists.
 *
 * `value` is nullable on a present key because the row's value column may be
 * SQL NULL or may hold the JSON literal `null`; neither is distinguishable
 * from the other once decoded, but both are distinguishable from absence.
 */
export type MetaEntry<T = unknown> =
  | { present: true; value: T | null }
  | { present: false };

/**
 * MetaService — small KV API over the `nextly_meta` table.
 *
 * Used for runtime flags that don't belong in collection schemas
 * (e.g., `seed.completedAt`, `seed.skippedAt`). All values are JSON
 * round-tripped: callers pass / receive JS values; the service
 * handles serialisation. Pg/MySQL native JSON columns store the
 * serialised string verbatim (no double-decoding on read since the
 * service is the only writer).
 *
 * Cross-dialect: looks up the right Drizzle table via `this.dialect`.
 */
export class MetaService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get table(): any {
    const d = this.dialect;
    if (d === "postgresql") return nextlyMetaPg;
    if (d === "mysql") return nextlyMetaMysql;
    return nextlyMetaSqlite;
  }

  // Drizzle handle. BaseService already exposes `this.db` via its
  // protected getter, but we widen it locally for the cross-dialect
  // table reference (whose type varies per dialect). Cast to any to
  // avoid a TS conflict with BaseService's typed `db`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get drizzle(): any {
    return this.adapter.getDrizzle();
  }

  /**
   * Read a key together with whether a row for it exists at all.
   *
   * `get` collapses three different situations onto `null`: no row, a row whose
   * value column is SQL NULL, and a row holding the JSON literal `null`.
   * Callers for which "absent" and "present but carrying nothing readable" mean
   * different things must use this instead, because for them the difference
   * decides whether it is safe to proceed.
   */
  async getEntry<T = unknown>(key: string): Promise<MetaEntry<T>> {
    const rows = await this.drizzle
      .select()
      .from(this.table)
      .where(eq(this.table.key, key))
      .limit(1);
    if (rows.length === 0) return { present: false };
    const raw = rows[0].value as string | null;
    if (raw === null || raw === undefined)
      return { present: true, value: null };
    try {
      return { present: true, value: JSON.parse(raw) as T };
    } catch {
      // Stored as a non-JSON string somehow — return as-is
      return { present: true, value: raw as T };
    }
  }

  // Delegates so there is one query and one decoding path; an absent row and a
  // row carrying no value both read as `null`, as callers of `get` expect.
  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = await this.getEntry<T>(key);
    return entry.present ? entry.value : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const serialised = JSON.stringify(value);
    const now = new Date();
    const existing = await this.drizzle
      .select({ key: this.table.key })
      .from(this.table)
      .where(eq(this.table.key, key))
      .limit(1);

    if (existing.length > 0) {
      await this.drizzle
        .update(this.table)
        .set({ value: serialised, updatedAt: now })
        .where(eq(this.table.key, key));
    } else {
      await this.drizzle
        .insert(this.table)
        .values({ key, value: serialised, updatedAt: now });
    }
  }

  /**
   * Write a key only if no row for it exists yet, leaving any existing row untouched.
   *
   * `set` reads the row and then inserts or updates, so two processes writing the same new key both
   * see nothing and both insert — one gets a primary-key violation, and if they disagree about the
   * value the survivor is whichever landed last. That is fine for a flag being stamped with the
   * same value from every caller, and not fine for a key whose value records a decision the losing
   * caller must abide by.
   *
   * Resolved by the database rather than by reading first: the conflict clause makes the check and
   * the write one statement. PostgreSQL and SQLite express it as `ON CONFLICT DO NOTHING`; MySQL
   * has no such clause and gets the equivalent no-op update of the key onto itself, so the row is
   * matched and left as it is. The builder is feature-detected because Drizzle exposes these under
   * different names per dialect.
   *
   * Says nothing about who won, deliberately. A caller that needs to know reads the row afterwards
   * and decides from its contents, which also covers losing to a caller that wrote the same value.
   */
  async insertIfAbsent(key: string, value: unknown): Promise<void> {
    const insert = this.drizzle
      .insert(this.table)
      .values({ key, value: JSON.stringify(value), updatedAt: new Date() });
    if (typeof insert.onConflictDoNothing === "function") {
      await insert.onConflictDoNothing();
      return;
    }
    if (typeof insert.onDuplicateKeyUpdate === "function") {
      await insert.onDuplicateKeyUpdate({ set: { key } });
      return;
    }
    await insert;
  }

  /**
   * Replace a key's value only if it still holds `expected`, reporting whether it did.
   *
   * The missing half of {@link insertIfAbsent}. That one settles a race to CREATE a key; this one
   * settles a race to MOVE one, which is a different problem and equally unserved by `set`: two
   * processes that both read the same value and both write leave whichever landed last, with
   * neither able to tell that it lost.
   *
   * Compares the serialised form rather than the decoded value, so the check is the same string
   * equality the database can perform in the `WHERE` clause — no read, no window between the
   * comparison and the write.
   *
   * False means the row has moved on: it was deleted, or someone else already claimed it. Callers
   * re-read and decide, because "someone else won" and "someone else won with the same intent" are
   * not the same outcome.
   */
  async compareAndSet(
    key: string,
    expected: unknown,
    next: unknown
  ): Promise<boolean> {
    const result = await this.drizzle
      .update(this.table)
      .set({ value: JSON.stringify(next), updatedAt: new Date() })
      .where(
        and(
          eq(this.table.key, key),
          eq(this.table.value, JSON.stringify(expected))
        )
      );
    // Each driver reports the affected count somewhere different, and mysql2 nests it inside a
    // result tuple, so the shared dialect-aware reader owns that knowledge.
    return affectedRowCount(result, this.dialect) > 0;
  }

  async delete(key: string): Promise<void> {
    await this.drizzle.delete(this.table).where(eq(this.table.key, key));
  }

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.drizzle.select().from(this.table);
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      const raw = row.value as string | null;
      if (raw === null || raw === undefined) {
        out[row.key as string] = null;
        continue;
      }
      try {
        out[row.key as string] = JSON.parse(raw);
      } catch {
        out[row.key as string] = raw;
      }
    }
    return out;
  }
}
