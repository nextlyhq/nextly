import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import { nextlyMeta as nextlyMetaMysql } from "../../../schemas/nextly-meta/mysql";
import { nextlyMeta as nextlyMetaPg } from "../../../schemas/nextly-meta/postgres";
import { nextlyMeta as nextlyMetaSqlite } from "../../../schemas/nextly-meta/sqlite";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";

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
