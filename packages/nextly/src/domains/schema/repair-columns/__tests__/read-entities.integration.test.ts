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
import { toCliError } from "../../../../cli/errors";
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

    /** The error the run stops on, as the command ends with it. */
    async function stopped() {
      const error: unknown = await read().then(
        () => {
          throw new Error("expected the run to stop");
        },
        (reason: unknown) => reason
      );
      const { code, what, why, next } = toCliError(error);
      return { code, what, why, next };
    }

    const INVALID_NEXT =
      "Restore it from version control; if a newer version of Nextly wrote it, upgrade `nextly` to that version. Then run `nextly repair-columns` again.";

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
      // Its migration file beside it: a snapshot is read only once its
      // migration was written.
      writeFileSync(join(migrationsDir, `${name}.sql`), "");
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
      expect(await stopped()).toEqual({
        code: "INVALID_SNAPSHOT",
        what: "The snapshot file `meta/0002_broken.snapshot.json` is invalid.",
        why: expect.stringMatching(
          /^JSON parse failed: .+\. Its migration is applied, so what the database last had applied cannot be known\.$/s
        ) as unknown,
        next: INVALID_NEXT,
      });
    });

    it("refuses to judge where the newest applied snapshot's entity record is malformed", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot(
        "0002_malformed",
        null,
        true,
        JSON.stringify({ version: 1, snapshot: { tables: [] }, entities: [] })
      );
      expect(await stopped()).toEqual({
        code: "INVALID_SNAPSHOT",
        what: "The snapshot file `meta/0002_malformed.snapshot.json` is invalid.",
        why: "It records its entities in a shape that cannot be read. Its migration is applied, so what the database last had applied cannot be known.",
        next: INVALID_NEXT,
      });
    });

    it("refuses to judge where the newest applied snapshot is not an object", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_list", null, true, "[]");
      expect(await stopped()).toMatchObject({
        code: "INVALID_SNAPSHOT",
        what: "The snapshot file `meta/0002_list.snapshot.json` is invalid.",
        why: expect.stringMatching(/^It is not a snapshot\. /) as unknown,
      });
    });

    it("names the migration file an applied snapshot has lost, not the snapshot", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      rmSync(join(migrationsDir, "0002_second.sql"));
      expect(await stopped()).toEqual({
        code: "MISSING_MIGRATION",
        what: "The snapshot `0002_second.snapshot.json` exists but no migration file of `0002_second` does.",
        why: "The migration is applied, and a snapshot is read only with its migration file beside it, so what the database last had applied cannot be known.",
        next: "Restore the migration's .sql file from version control, or, if it was removed on purpose, record that with `nextly migrate:resolve --removed <file>`, then run `nextly repair-columns` again.",
      });
    });

    it("names the migration, not a file it never had, where it was a dialect's variant alone", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      // Its only file was this one; the base file never existed.
      rmSync(join(migrationsDir, "0002_second.sql"));
      writeFileSync(join(migrationsDir, `0002_second.${dialect}.sql`), "");
      expect((await posts())?.applied?.source).toBe("snapshot");
      rmSync(join(migrationsDir, `0002_second.${dialect}.sql`));
      const { code, what, next } = await stopped();
      expect(code).toBe("MISSING_MIGRATION");
      expect(`${what} ${next}`).toContain("`0002_second`");
      expect(`${what} ${next}`).not.toContain("0002_second.sql");
    });

    /** The records an attempt at an applied migration's file leaves after its applied one. */
    const LATER_RECORDS: Record<string, (name: string) => Promise<void>> = {
      "an attempt that failed": async name => {
        const events = new SchemaEventsRepository(
          adapter().getDrizzle(),
          dialect
        );
        await events.markFailed(await startAgain(name), {
          errorMessage: "column already exists",
        });
      },
      "an attempt that recorded no outcome": async name => {
        await startAgain(name);
      },
      "an attempt cleared by --failed-cleanup": async name => {
        const events = new SchemaEventsRepository(
          adapter().getDrizzle(),
          dialect
        );
        const id = await startAgain(name);
        await events.markFailed(id, { errorMessage: "column already exists" });
        await events.markRolledBack(id);
      },
    };

    /** Start an attempt at a file the ledger already records applied. */
    const startAgain = (name: string) =>
      new SchemaEventsRepository(adapter().getDrizzle(), dialect).recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: `${name}.sql`,
      });

    it.each(Object.keys(LATER_RECORDS))(
      "reads an applied migration's snapshot past %s",
      async record => {
        await snapshot("0001_first", [{ name: "price", type: "number" }], true);
        await snapshot(
          "0002_second",
          [{ name: "summary", type: "text" }],
          true
        );
        await LATER_RECORDS[record]("0002_second");
        expect((await posts())?.applied?.fields.map(f => f.name)).toEqual([
          "summary",
        ]);
      }
    );

    it("reads the older snapshot once the newer migration is rolled back", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      const events = new SchemaEventsRepository(
        adapter().getDrizzle(),
        dialect
      );
      const retired = (await events.findFileApplies("0002_second.sql")).map(
        row => row.id
      );
      const id = await events.insertEvent({
        eventType: "file_apply",
        status: "rolled_back",
        source: "cli-migrate",
        filename: "0002_second.sql",
        endedAt: new Date(),
        supersededEventIds: retired,
      });
      await events.supersede({ supersededEventIds: retired, byEventId: id });
      expect((await posts())?.applied?.fields.map(f => f.name)).toEqual([
        "price",
      ]);
    });

    /** Record a migration's file removed on purpose, as `migrate:resolve --removed` does. */
    async function removedOnPurpose(name: string) {
      rmSync(join(migrationsDir, `${name}.sql`));
      const events = new SchemaEventsRepository(
        adapter().getDrizzle(),
        dialect
      );
      await events.recordRemoval({
        filename: `${name}.sql`,
        sha256: "a".repeat(64),
      });
    }

    it("reads the snapshot of an applied migration whose file was removed on purpose", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      await removedOnPurpose("0002_second");
      const entity = await posts();
      expect(entity?.applied?.source).toBe("snapshot");
      expect(entity?.applied?.fields.map(f => f.name)).toEqual(["summary"]);
    });

    it("goes on past a removed migration older than the newest, which it keeps reading", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      await removedOnPurpose("0001_first");
      expect((await posts())?.applied?.fields.map(f => f.name)).toEqual([
        "summary",
      ]);
    });

    it("stops where a removed migration was applied again and its file is gone once more", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      await removedOnPurpose("0002_second");
      // The removal is about the outcome it followed, not the one after it.
      const events = new SchemaEventsRepository(
        adapter().getDrizzle(),
        dialect
      );
      for (const row of await events.findFileApplies("0002_second.sql")) {
        await events.markRolledBack(row.id);
      }
      await snapshot("0002_second", [{ name: "summary", type: "text" }], true);
      rmSync(join(migrationsDir, "0002_second.sql"));
      expect((await stopped()).code).toBe("MISSING_MIGRATION");
    });

    it("stops on a removed migration's snapshot that cannot be parsed, naming the snapshot", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_broken", null, true, "{ not json");
      await removedOnPurpose("0002_broken");
      expect(await stopped()).toMatchObject({
        code: "INVALID_SNAPSHOT",
        what: "The snapshot file `meta/0002_broken.snapshot.json` is invalid.",
      });
    });

    it("reads past an unreadable snapshot whose migration has not been applied", async () => {
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot("0002_unapplied", null, false, "{ not json");
      const entity = await posts();
      expect(entity?.applied?.source).toBe("snapshot");
      expect(entity?.applied?.fields.map(f => f.name)).toEqual(["price"]);
    });

    it("stops where an applied snapshot newer than the record read records no entities", async () => {
      // An earlier release's `migrate:create` wrote 0002 after 0001, which records them: judged by
      // 0001, the columns 0002 changed would be converted back.
      await snapshot("0001_first", [{ name: "price", type: "number" }], true);
      await snapshot(
        "0002_older_format",
        null,
        true,
        JSON.stringify({ version: 1, snapshot: { tables: [] } })
      );
      expect(await stopped()).toMatchObject({
        code: "SNAPSHOT_WITHOUT_ENTITIES",
        what: "The applied migration `0002_older_format` has a snapshot that records no entities, and the older `0001_first` has one that does.",
      });
    });

    it("reads past an applied snapshot written before snapshots recorded entities, older than the record", async () => {
      await snapshot(
        "0001_older_format",
        null,
        true,
        JSON.stringify({ version: 1, snapshot: { tables: [] } })
      );
      await snapshot("0002_first", [{ name: "price", type: "number" }], true);
      const entity = await posts();
      expect(entity?.applied?.fields.map(f => f.name)).toEqual(["price"]);
    });
  }
);
