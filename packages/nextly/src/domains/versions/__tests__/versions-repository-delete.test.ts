/**
 * Chunking of the retention delete.
 *
 * Each id binds one query parameter. The SQLite adapter declares
 * `maxParamsPerQuery: 999`, so a backlog larger than that must be deleted
 * across several statements rather than one oversized one — otherwise the
 * statement fails and takes the surrounding write transaction with it.
 *
 * Tested against a stub rather than a live database: the bundled SQLite build
 * happens to allow far more variables than the declared limit, so a real query
 * would not demonstrate the boundary the adapter contract specifies.
 */
import { describe, expect, it, vi } from "vitest";

import type { VersionsDbApi, VersionsWhere } from "../db-api";
import { VersionsRepository } from "../versions-repository";

/** Records the id batches passed to each delete call. */
function stubDb() {
  const batches: string[][] = [];
  const db: VersionsDbApi = {
    insert: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(async (_table: string, where: VersionsWhere) => {
      const condition = where.and?.[0];
      const value = condition?.value;
      batches.push(Array.isArray(value) ? (value as string[]) : []);
      return Array.isArray(value) ? value.length : 0;
    }),
  };
  return { db, batches };
}

describe("VersionsRepository.deleteByIds", () => {
  it("issues no statement for an empty list", async () => {
    const { db, batches } = stubDb();
    const deleted = await new VersionsRepository(db).deleteByIds([]);
    expect(deleted).toBe(0);
    expect(batches).toEqual([]);
  });

  it("deletes a small list in a single statement", async () => {
    const { db, batches } = stubDb();
    const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);

    const deleted = await new VersionsRepository(db).deleteByIds(ids);

    expect(deleted).toBe(10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
  });

  it("splits a backlog beyond the parameter limit across statements", async () => {
    const { db, batches } = stubDb();
    const ids = Array.from({ length: 1200 }, (_, i) => `id-${i}`);

    const deleted = await new VersionsRepository(db).deleteByIds(ids);

    // Every id is still removed, and no single statement exceeds the cap.
    expect(deleted).toBe(1200);
    expect(batches.length).toBeGreaterThan(1);
    expect(Math.max(...batches.map(b => b.length))).toBeLessThanOrEqual(999);
    expect(batches.flat()).toHaveLength(1200);
    expect(new Set(batches.flat()).size).toBe(1200);
  });
});
