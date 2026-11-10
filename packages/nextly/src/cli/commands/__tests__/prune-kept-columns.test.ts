/**
 * Where `nextly prune` finds the columns a plugin's scope keeps on types
 * switched off: in the tables themselves on a site that applies its schema
 * directly, and in the latest snapshot on one that keeps migration files,
 * whose prune writes the migration that drops them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { text } from "../../../config";
import { writeSnapshot } from "../../../domains/schema/migrate-create/snapshot-io";
import {
  publishWithheldScopeFields,
  scopedTypeKey,
} from "../../../domains/schema/pipeline/withheld-scope-fields";
import type { Deletion } from "../../../domains/schema/migrate/data-loss-consent";
import { runPrune } from "../prune";
import {
  configuredTypes,
  currentTypes,
  keptColumnsFor,
} from "../prune-kept-columns";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-prune-kept-"));
  // A scope holds `seo` back from `pages`, switched off.
  publishWithheldScopeFields(
    new Map([[scopedTypeKey("collection", "pages"), [text({ name: "seo" })]]])
  );
});

afterEach(() => {
  publishWithheldScopeFields(new Map());
  rmSync(dir, { recursive: true, force: true });
});

const pages = {
  kind: "collection" as const,
  slug: "pages",
  tableName: "dc_pages",
  fields: [text({ name: "title" })],
};

const args = () => ({
  cwd: dir,
  migrationsDir: "./migrations",
  adapter: { getDrizzle: () => ({}) as never },
  dialect: "sqlite" as const,
  types: [pages],
});

/** The registry's rows: each still lists `seo`, as before the site restarts. */
const staleRegistries = {
  collections: {
    getAllCollections: async () => [
      {
        slug: "pages",
        tableName: "dc_pages",
        source: "code",
        fields: [text({ name: "title" }), text({ name: "seo" })],
      },
      {
        slug: "cases",
        tableName: "dc_cases",
        source: "ui",
        fields: [
          { name: "summary", type: "text" },
          { name: "seo", type: "text", source: "plugin" },
        ],
      },
    ],
  },
  singles: { getAllSingles: async () => [] },
};

describe("currentTypes", () => {
  it("judges each type by what it declares now, not by its registry row", async () => {
    publishWithheldScopeFields(
      new Map([
        [scopedTypeKey("collection", "pages"), [text({ name: "seo" })]],
        [scopedTypeKey("collection", "cases"), [text({ name: "seo" })]],
      ])
    );

    const types = await currentTypes({
      configured: configuredTypes({
        collections: [{ slug: "pages", fields: [text({ name: "title" })] }],
      }),
      registries: staleRegistries,
    });

    expect(
      types.map(type => [
        type.slug,
        (type.fields as { name: string }[]).map(field => field.name),
      ])
    ).toEqual([
      ["pages", ["title"]],
      ["cases", ["summary"]],
    ]);
  });
});

describe("keptColumnsFor", () => {
  it("reads the tables when the site keeps no migration files", async () => {
    const kept = await keptColumnsFor(args());

    expect(kept.inMigration).toEqual([]);
    expect(kept.live).toBeTypeOf("function");
  });

  it("reads the latest snapshot when the site keeps migration files, and drops nothing itself", async () => {
    await writeSnapshot(
      join(dir, "migrations", "meta"),
      "20261110_000000_000_create",
      {
        tables: [
          {
            name: "dc_pages",
            columns: [
              { name: "title", type: "text", nullable: true },
              { name: "seo", type: "text", nullable: true },
            ],
            indexes: [],
          },
        ],
      } as never,
      "SELECT 1;"
    );

    const kept = await keptColumnsFor(args());

    expect(kept.live).toBeUndefined();
    expect(kept.inMigration).toEqual([{ table: "dc_pages", column: "seo" }]);
  });
});

describe("runPrune and the columns a migration drops", () => {
  const prune = (approve: (deletions: Deletion[]) => Promise<boolean>) =>
    runPrune({
      registry: {
        findOrphanedCollections: async () => [],
        deleteCollection: async () => {},
        assertNothingDependsOn: async () => {},
      } as never,
      adapter: {
        getCapabilities: () => ({ dialect: "sqlite" }),
        listTables: async () => [],
        executeQuery: async () => [],
      } as never,
      lock: work => work(),
      currentSlugs: ["pages"],
      approve,
      releasedByMigration: [{ table: "dc_pages", column: "seo" }],
    });

  it("asks about them with everything else, before anything is dropped", async () => {
    const asked: Deletion[][] = [];
    const result = await prune(async deletions => {
      asked.push(deletions);
      return true;
    });

    expect(asked).toEqual([
      [{ kind: "column", table: "dc_pages", column: "seo" }],
    ]);
    expect(result.consented).toBe(true);
    // A migration drops them, not the prune.
    expect(result.droppedColumns).toEqual([]);
  });

  it("reports nothing agreed when the consent refuses", async () => {
    expect((await prune(async () => false)).consented).toBe(false);
  });
});
