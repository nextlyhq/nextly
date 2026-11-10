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
  types: async () => [pages],
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

/** The scope, deferred for the Builder's types, that switches `cases` off. */
const offForCases = {
  target: { every: ["collection" as const], except: ["cases"] },
  fields: [text({ name: "seo" })],
  owner: "@t/seo",
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
      deferredExtends: [offForCases],
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
  it("reads the site's types again each time it plans, as the prune does under its lock", async () => {
    let reads = 0;
    const kept = await keptColumnsFor({
      ...args(),
      types: async () => {
        reads += 1;
        return [pages];
      },
    });
    // Each plan reads the tables too, which this stub database cannot answer.
    await kept.live?.().catch(() => undefined);
    await kept.live?.().catch(() => undefined);

    expect(reads).toBe(2);
  });

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

describe("currentTypes and a plugin clause still naming the type", () => {
  it("keeps a field a clause naming a Builder type still gives it as declared", async () => {
    publishWithheldScopeFields(
      new Map([[scopedTypeKey("collection", "cases"), [text({ name: "seo" })]]])
    );

    const types = await currentTypes({
      configured: [],
      deferredExtends: [
        offForCases,
        { target: "cases", fields: [text({ name: "seo" })], owner: "@t/seo" },
      ],
      registries: staleRegistries,
    });

    expect(
      types
        .filter(type => type.slug === "cases")
        .map(type => (type.fields as { name: string }[]).map(f => f.name))
    ).toEqual([["summary", "seo"]]);
  });
});

describe("keptColumnsFor and a translated kept column", () => {
  it("lists none a migration never drops, on a site that keeps migration files", async () => {
    await writeSnapshot(
      join(dir, "migrations", "meta"),
      "20261110_000000_000_create",
      {
        tables: [
          {
            name: "dc_pages",
            columns: [{ name: "title", type: "text", nullable: true }],
            indexes: [],
            localized: true,
            localizedColumns: ["seo"],
          },
        ],
      } as never,
      "SELECT 1;"
    );

    expect((await keptColumnsFor(args())).inMigration).toEqual([]);
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
