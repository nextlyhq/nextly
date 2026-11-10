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
import { keptColumnsFor } from "../prune-kept-columns";

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

const args = () => ({
  cwd: dir,
  migrationsDir: "./migrations",
  adapter: { getDrizzle: () => ({}) as never },
  dialect: "sqlite" as const,
  registries: {
    collections: {
      getAllCollections: async () => [
        {
          slug: "pages",
          tableName: "dc_pages",
          fields: [text({ name: "title" })],
        },
      ],
    },
    singles: { getAllSingles: async () => [] },
  },
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
