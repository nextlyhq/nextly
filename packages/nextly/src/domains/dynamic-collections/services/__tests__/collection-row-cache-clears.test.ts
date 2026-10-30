/**
 * The paths that write collection registry rows without going through a
 * registry service clear the collection row cache themselves: a schema apply
 * (landed or failed), a registration from migration snapshots, and a reload of
 * the dynamic tables. Each is observed through the cache: a row cached before
 * the path runs is read again after it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { reloadDynamicTables } from "../../../../init/reload-dynamic-tables";
import { registerFromMigrations } from "../../../schema/migrate/metadata-register";
import { createApplyDesiredSchema } from "../../../schema/pipeline/apply";
import {
  cachedCollectionRow,
  clearRegistryRowCache,
} from "../collection-row-cache";

const database = {};

/** Caches the `posts` row, and answers whether the next read goes to the database. */
async function cachedThenRead(run: () => Promise<unknown>): Promise<boolean> {
  const read = vi.fn(async () => ({ slug: "posts" }));
  await cachedCollectionRow(database, "posts", read);
  await run();
  await cachedCollectionRow(database, "posts", read);
  return read.mock.calls.length === 2;
}

beforeEach(() => {
  clearRegistryRowCache();
});

describe("writes outside the registry services clear the collection row cache", () => {
  const desired = { collections: {}, singles: {}, components: {} };
  const deps = {
    readSchemaVersionForSlug: async () => null,
    readNewSchemaVersionsForSlugs: async () => ({}),
  };

  it("a schema apply that lands", async () => {
    const apply = createApplyDesiredSchema({
      ...deps,
      applyPipeline: async () => ({ success: true, statementsExecuted: 0 }),
    } as never);
    expect(
      await cachedThenRead(() =>
        apply(desired, "code", { promptChannel: "terminal" })
      )
    ).toBe(true);
  });

  it("a schema apply that fails part way", async () => {
    const apply = createApplyDesiredSchema({
      ...deps,
      applyPipeline: async () => {
        throw new Error("DDL failed after the registry rows were written");
      },
    } as never);
    expect(
      await cachedThenRead(() =>
        apply(desired, "code", { promptChannel: "terminal" })
      )
    ).toBe(true);
  });

  it("a registration from migration snapshots", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nextly-row-cache-"));
    try {
      mkdirSync(join(dir, "meta"));
      writeFileSync(
        join(dir, "meta", "0001_init.snapshot.json"),
        JSON.stringify({
          collections: [
            {
              slug: "posts",
              label: "posts",
              tableName: "dc_posts",
              fields: [],
            },
          ],
          singles: [],
        })
      );
      const adapter = {
        getDrizzle: () => ({
          select: () => ({
            from: () => ({ where: () => ({ limit: async () => [] }) }),
          }),
          insert: () => ({ values: async () => undefined }),
        }),
      } as never;
      expect(
        await cachedThenRead(() =>
          registerFromMigrations({
            migrationsDir: dir,
            adapter,
            dialect: "sqlite",
            logger: { warn: () => {}, debug: () => {} },
          })
        )
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a reload of the dynamic tables", async () => {
    // Nothing is registered to reload into here; the reload still begins by
    // clearing, since it follows a change to the registry made elsewhere.
    expect(await cachedThenRead(() => reloadDynamicTables("[test]"))).toBe(
      true
    );
  });

  it("and nothing else: a cached row is served while no path runs", async () => {
    // The control: without it, a cache that never kept anything would pass
    // every case above.
    expect(await cachedThenRead(async () => undefined)).toBe(false);
  });
});
