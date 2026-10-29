/**
 * `readRepairEntities` reads the registry, the applied migration snapshots and the stored user
 * fields from a live database, and hands each entity the definition the database last had applied.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { getSchemaEventsDdl } from "../../events/schema-events-ddl";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { readRepairEntities } from "../read-entities";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * A snapshot file as `migrate:create` writes it, recording one Builder collection's settings, or,
 * with `fields` null, an entity record that no longer declares that collection.
 */
function snapshotFile(fields: unknown[] | null) {
  return JSON.stringify({
    version: 1,
    migrationHash: "0",
    snapshot: { tables: [] },
    entities: {
      collections:
        fields === null
          ? {}
          : {
              rcposts: {
                source: "builder",
                settings: { slug: "rcposts", fields },
              },
            },
      singles: {},
      fieldGroups: {},
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "readRepairEntities on %s",
  dialect => {
    let handle: TestNextly;
    let migrationsDir: string;
    const adapter = () => handle.adapter as unknown as DrizzleAdapter;
    const read = () =>
      readRepairEntities({
        adapter: adapter(),
        dialect,
        config: { collections: [] },
        migrationsDir,
        logger: silent,
      });
    const posts = async () =>
      (await read()).find(e => e.kind === "collection" && e.slug === "rcposts");

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-repair-columns-"));
      mkdirSync(join(migrationsDir, "meta"));
      if (!(await adapter().tableExists("nextly_schema_events"))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await adapter().executeQuery(statement);
        }
      }
      await seedBuilderCollection(adapter(), {
        slug: "rcposts",
        fields: [{ name: "links", type: "repeater", fields: [] }],
      });
    });

    afterEach(async () => {
      rmSync(migrationsDir, { recursive: true, force: true });
      await adapter().executeQuery("DROP TABLE IF EXISTS dc_rcposts");
      await handle?.destroy();
    });

    /** Write a snapshot and, when `applied`, record its migration in the ledger. */
    async function snapshot(
      name: string,
      fields: unknown[] | null,
      applied: boolean
    ) {
      writeFileSync(
        join(migrationsDir, "meta", `${name}.snapshot.json`),
        snapshotFile(fields)
      );
      if (!applied) return;
      const events = new SchemaEventsRepository(
        adapter().getDrizzle(),
        dialect
      );
      const filename = `${name}.sql`;
      const id = await events.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename,
      });
      await events.markApplied(id, { uniqueFilename: filename });
    }

    it("reads a Builder collection from its registry row where no applied snapshot records it", async () => {
      const entity = await posts();
      expect(entity?.applied.source).toBe("registry");
      expect(entity?.origin).toBe("collection");
      expect(entity?.table).toBe("dc_rcposts");
      expect(entity?.applied.fields.map(f => f.name)).toContain("links");
    });

    it("takes the newest applied snapshot over the registry row, and skips one not yet applied", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      await snapshot("0003_pending", [{ name: "later", type: "text" }], false);

      const entity = await posts();
      expect(entity?.applied.source).toBe("snapshot");
      expect(entity?.applied.fields.map(f => f.name)).toEqual(["summary"]);
      // The Builder's saved row is the configured definition the next migration will apply.
      expect(entity?.configured?.fields.map(f => f.name)).toContain("links");
      expect(entity?.origin).toBe("collection");
    });

    it("reads no snapshot record for a collection the newest applied snapshot omits", async () => {
      // Every snapshot records every declared entity whole, so one that omits the collection says
      // it was removed from the configuration; an older snapshot's record of it is out of date.
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_removed", null, true);

      const entity = await posts();
      expect(entity?.applied.source).toBe("registry");
      expect(entity?.applied.fields.map(f => f.name)).toEqual(["links"]);
    });

    it("reads user fields from the stored definitions", async () => {
      // A booted instance has the definitions table, so absence cannot pass this case.
      expect(await adapter().tableExists("user_field_definitions")).toBe(true);
      const users = (await read()).find(e => e.kind === "userFields");
      expect(users?.table).toBe("user_ext");
      expect(users?.origin).toBe("userFields");
      expect(users?.applied.source).toBe("registry");
    });
  }
);
