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
    const read = (users?: { fields: unknown[] }) =>
      readRepairEntities({
        adapter: adapter(),
        dialect,
        config: {
          collections: [],
          db: { uiSchemaFile: "ui-schema.json" },
          ...(users !== undefined ? { users } : {}),
        },
        // No manifest there: the ordinary code-first project.
        projectRoot: migrationsDir,
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

    /** The error naming a snapshot file the run could not read, as the command prints it. */
    const unreadable = (name: string) => ({
      code: "CONFIGURATION_ERROR",
      logMessage: expect.stringContaining(
        `meta/${name}.snapshot.json`
      ) as unknown,
    });

    /**
     * Write a snapshot and, when `applied`, record its migration in the ledger. `content` is the
     * file's text where the test needs one `migrate:create` would never write.
     */
    async function snapshot(
      name: string,
      fields: unknown[] | null,
      applied: boolean,
      content: string = snapshotFile(fields)
    ) {
      writeFileSync(
        join(migrationsDir, "meta", `${name}.snapshot.json`),
        content
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
      expect(entity?.applied?.source).toBe("registry");
      expect(entity?.applied?.origin).toBe("collection");
      expect(entity?.table).toBe("dc_rcposts");
      expect(entity?.applied?.fields.map(f => f.name)).toContain("links");
    });

    it("takes the newest applied snapshot over the registry row, and skips one not yet applied", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      await snapshot("0003_pending", [{ name: "later", type: "text" }], false);

      const entity = await posts();
      expect(entity?.applied?.source).toBe("snapshot");
      expect(entity?.applied?.fields.map(f => f.name)).toEqual(["summary"]);
      // The Builder's saved row is the configured definition the next migration will apply.
      expect(entity?.configured?.fields.map(f => f.name)).toContain("links");
      expect(entity?.applied?.origin).toBe("collection");
    });

    it("reads no snapshot record for a collection the newest applied snapshot omits", async () => {
      // Every snapshot records every declared entity whole, so one that omits the collection says
      // it was removed from the configuration; an older snapshot's record of it is out of date.
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_removed", null, true);

      const entity = await posts();
      expect(entity?.applied?.source).toBe("registry");
      expect(entity?.applied?.fields.map(f => f.name)).toEqual(["links"]);
    });

    it("reads user fields from the stored definitions", async () => {
      // A booted instance has the definitions table, so absence cannot pass this case.
      expect(await adapter().tableExists("user_field_definitions")).toBe(true);
      const users = (await read()).find(e => e.kind === "userFields");
      expect(users?.table).toBe("user_ext");
      expect(users?.applied?.origin).toBe("userFields");
      expect(users?.applied?.source).toBe("registry");
    });

    it("configures a code user field the definitions do not hold yet", async () => {
      // Declared in code and never synced: the next migration stores it and adds its column.
      const users = (
        await read({ fields: [{ name: "rcBadge", type: "text" }] })
      ).find(e => e.kind === "userFields");
      expect(users?.applied?.fields.map(f => f.name)).not.toContain("rcBadge");
      expect(users?.configured?.fields.map(f => f.name)).toContain("rcBadge");
    });

    it("refuses to judge from an older record where an applied snapshot cannot be read", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_broken", null, true, "{ not json");
      await expect(read()).rejects.toMatchObject(unreadable("0002_broken"));
    });

    it("refuses to judge where the newest applied snapshot's entity record is malformed", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot(
        "0002_malformed",
        null,
        true,
        JSON.stringify({ version: 1, snapshot: { tables: [] }, entities: [] })
      );
      await expect(read()).rejects.toMatchObject(unreadable("0002_malformed"));
    });

    it("reads past an unreadable snapshot whose migration has not been applied", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_unapplied", null, false, "{ not json");
      const entity = await posts();
      expect(entity?.applied?.source).toBe("snapshot");
      expect(entity?.applied?.fields.map(f => f.name)).toEqual(["price"]);
    });

    it("reads past an applied snapshot written before snapshots recorded entities", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot(
        "0002_older_format",
        null,
        true,
        JSON.stringify({ version: 1, snapshot: { tables: [] } })
      );
      const entity = await posts();
      expect(entity?.applied?.fields.map(f => f.name)).toEqual(["price"]);
    });
  }
);
