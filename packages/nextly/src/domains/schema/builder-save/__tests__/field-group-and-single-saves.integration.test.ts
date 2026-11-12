/**
 * A Schema Builder save of a field group or a Single writes its migration, as
 * a collection's does.
 *
 * `nextly migrate` judges each pending file against the snapshots on either
 * side of it, and every table a snapshot does not record counts as drift. A
 * field group or a Single the Builder created by pushing its table, with no
 * file, left that table on no record: the next migration, a collection's
 * included, was then refused with "table 'comp_<slug>' present in DB".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../../../collections/services/collection-service";

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

const HISTORY = "./database/history";

/** The tables the newest snapshot records, by name. */
function latestSnapshotTables(t: TestNextly): string[] {
  const meta = join(t.basePath, "database", "history", "meta");
  const newest = readdirSync(meta)
    .filter(f => f.endsWith(".snapshot.json"))
    .sort()
    .at(-1);
  if (newest === undefined) return [];
  const parsed = JSON.parse(readFileSync(join(meta, newest), "utf-8")) as {
    snapshot?: { tables?: { name: string }[] };
    tables?: { name: string }[];
  };
  return (parsed.snapshot?.tables ?? parsed.tables ?? []).map(t => t.name);
}

/** The migration files written, by name. */
function migrationFiles(t: TestNextly): string[] {
  return readdirSync(join(t.basePath, "database", "history")).filter(f =>
    f.endsWith(".sql")
  );
}

describe.each(getConfiguredTestDialects())(
  "a Builder save of a field group or a Single (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        db: { migrationsDir: HISTORY, uiSchemaFile: "./schema/builder.json" },
      });
      instance = t;
      // As the Builder runs: each save is applied, and recorded, here.
      vi.stubEnv("NODE_ENV", "development");
      return t;
    }

    it("writes a field group's migration, recording its table", async () => {
      const t = await boot();

      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );

      expect(migrationFiles(t).some(f => /_meta_create\.sql$/.test(f))).toBe(
        true
      );
      expect(latestSnapshotTables(t)).toContain("comp_meta");
    });

    it("writes a Single's migration, recording its table", async () => {
      const t = await boot();

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [{ name: "heading", type: "text" }],
        }
      );

      expect(migrationFiles(t).some(f => /_notice_create\.sql$/.test(f))).toBe(
        true
      );
      expect(latestSnapshotTables(t)).toContain("single_notice");
    });

    it("lets a collection's save follow a field group's, with both tables on record", async () => {
      const t = await boot();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );

      // The collection's file runs through the drift check, which once found
      // the field group's table on no record and refused it.
      await t.getService("collectionService").createCollection(
        {
          name: "articles",
          label: "Article",
          fields: [
            { name: "body", type: "text" },
            { name: "meta", type: "component", component: "meta" },
          ],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );

      expect(latestSnapshotTables(t)).toEqual(
        expect.arrayContaining(["comp_meta", "dc_articles"])
      );
    });
  }
);
