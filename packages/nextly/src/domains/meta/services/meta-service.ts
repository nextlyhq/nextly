import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import { nextlyMeta as nextlyMetaMysql } from "../../../database/schema/mysql";
import { nextlyMeta as nextlyMetaPg } from "../../../database/schema/postgres";
import { nextlyMeta as nextlyMetaSqlite } from "../../../database/schema/sqlite";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";

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
    const d = this.dialect as "postgresql" | "mysql" | "sqlite";
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

  async get<T = unknown>(key: string): Promise<T | null> {
    const rows = await this.drizzle
      .select()
      .from(this.table)
      .where(eq(this.table.key, key))
      .limit(1);
    if (rows.length === 0) return null;
    const raw = rows[0].value as string | null;
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Stored as a non-JSON string somehow — return as-is
      return raw as T;
    }
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
