/**
 * A migration that drops a collection or Single removed from code ends every one of its documents
 * with exactly one deletion event, on PostgreSQL, MySQL and SQLite, whether `migrate:create` wrote
 * the drop or a person did, and however the run stopped after the drop.
 *
 * Hand-written files here: one creates a translated collection and a translated Single, each with
 * a junction, and a collection that stays; a later one drops the first two. The documents of the
 * two are captured before the drop, in the file's transaction, and their deletion events recorded
 * once the file is recorded applied. A run stopped once the files are recorded, or while it records
 * the events, is finished by the next with nothing pending and no event twice; one stopped inside
 * the file (PostgreSQL and SQLite) removes nothing, and the next run applies the file whole. And a
 * drop of a collection another one's field still names is refused, with nothing removed.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  resolveDataLossConsent,
  type DataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";

const logger = createLogger({ quiet: true });

/** A many-to-many field keeping its links in a junction it names. */
function manyToMany(name: string, target: string, junctionTable: string) {
  return {
    name,
    type: "relationship",
    options: { relationType: "manyToMany", target, junctionTable },
  };
}

describe.each(LOCK_DIALECTS)(
  "a migration retiring entities removed from code on %s",
  dialect => {
    const P = `rre_${randomBytes(3).toString("hex")}`;
    // A translated collection and a translated Single the drop retires, each with a junction.
    const posts = `${P}_posts`;
    const home = `${P}_home`;
    // A collection that stays, with a junction of its own.
    const pages = `${P}_pages`;
    let seq = 0;
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-retire-removed-"));
      // Nextly's own tables first, then the entities' tables and documents.
      await migrate();
      const entityTables = (main: string, junction: string) => [
        `CREATE TABLE ${main} (id varchar(36) PRIMARY KEY, title varchar(64))`,
        `CREATE TABLE ${main}_locales (id varchar(36) PRIMARY KEY, parent_id varchar(36), locale varchar(8), title varchar(64))`,
        `CREATE TABLE ${junction} (id varchar(36) PRIMARY KEY, source_id varchar(36), target_id varchar(36))`,
        // Two documents: one with history before the drop, one from before content history.
        `INSERT INTO ${main} (id, title) VALUES ('e1', 'a'), ('e2', 'b')`,
      ];
      file([
        ...entityTables(posts, `${posts}_tags`),
        ...entityTables(home, `${home}_links`),
        ...entityTables(pages, `${pages}_refs`),
      ]);
      expect((await migrate()).applied).toBe(1);
      await register("collection", "posts", posts, `${posts}_tags`);
      await register("single", "home", home, `${home}_links`);
      await register("collection", "pages", pages, `${pages}_refs`);
      // `e1` has an event before the drop; `e2` has none.
      for (const [kind, slug] of [
        ["collection", "posts"],
        ["single", "home"],
        ["collection", "pages"],
      ] as const) {
        await adapter.insert("nextly_content_events", {
          id: randomUUID(),
          subjectKind: kind,
          subjectSlug: slug,
          subjectId: "e1",
          kind: "updated",
          actorKind: "system",
          occurredAt: new Date(),
        });
      }
    }, 180_000);

    afterEach(async () => {
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    /** The entity's registry row, naming its main table and the fields `extra` adds. */
    async function register(
      kind: "collection" | "single",
      slug: string,
      table: string,
      junction: string,
      extra: unknown[] = []
    ) {
      const now = new Date();
      const common = {
        id: randomUUID(),
        slug,
        tableName: table,
        fields: [
          { name: "title", type: "text" },
          manyToMany("links", "x", junction),
          ...extra,
        ],
        schemaHash: "h",
        source: "code",
        createdAt: now,
        updatedAt: now,
      };
      await adapter.insert(
        kind === "collection" ? "dynamic_collections" : "dynamic_singles",
        kind === "collection"
          ? { ...common, labels: { singular: slug, plural: slug } }
          : { ...common, label: slug }
      );
    }

    function migrate(
      consent?: DataLossConsent,
      stopAt?: (point: string) => void
    ) {
      return migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "wait",
        lockWaitMs: 30_000,
        ...(consent === undefined ? {} : { consent }),
        interactive: false,
        askToDelete: () => Promise.resolve(false),
        ensureLedger: () => ensureSchemaEventsTable(adapter),
        ...(stopAt === undefined ? {} : { stopAt }),
      });
    }

    /** A hand-written migration file, after the ones before it, with no snapshot. */
    function file(up: string[]): string {
      seq += 1;
      const name = `20261120_${String(seq).padStart(6, "0")}_${P}`;
      writeFileSync(
        join(migrationsDir, `${name}.sql`),
        `-- Migration: ${name}\n\n-- UP\n${up.map(s => `${s};`).join("\n")}\n\n-- DOWN\n`,
        "utf8"
      );
      return `${name}.sql`;
    }

    /** The migration that drops both entities: junctions, then translation tables, then main tables. */
    function dropBoth(): string {
      return file([
        `DROP TABLE ${posts}_tags`,
        `DROP TABLE ${home}_links`,
        `DROP TABLE ${posts}_locales`,
        `DROP TABLE ${home}_locales`,
        `DROP TABLE ${posts}`,
        `DROP TABLE ${home}`,
      ]);
    }

    const bothConsent = () =>
      resolveDataLossConsent({ flag: `${posts},${home}`, env: {} });

    /** How many deletion events each document of `slug` has. */
    async function deletionsOf(
      kind: "collection" | "single",
      slug: string
    ): Promise<Record<string, number>> {
      const rows = await adapter.select<{ subjectId: string }>(
        "nextly_content_events",
        {
          where: {
            and: [
              { column: "subjectKind", op: "=", value: kind },
              { column: "subjectSlug", op: "=", value: slug },
              { column: "kind", op: "=", value: "deleted" },
            ],
          },
        }
      );
      const counts: Record<string, number> = {};
      for (const row of rows) {
        counts[row.subjectId] = (counts[row.subjectId] ?? 0) + 1;
      }
      return counts;
    }

    /** The captures waiting in `nextly_meta`. */
    async function captures(): Promise<number> {
      const rows = await adapter.select<{ key: string }>("nextly_meta", {});
      return rows.filter(row => row.key.startsWith("retired_documents:"))
        .length;
    }

    const ledger = async () =>
      (
        await new SchemaEventsRepository(
          adapter.getDrizzle(),
          dialect
        ).listFileApplies()
      ).length;

    const EACH_ONCE = { e1: 1, e2: 1 };

    it("ends every document of the dropped entities with one deletion event, and none of the one that stays", async () => {
      dropBoth();
      const run = await migrate(bothConsent());

      expect(run.applied).toBe(1);
      expect(await deletionsOf("collection", "posts")).toEqual(EACH_ONCE);
      expect(await deletionsOf("single", "home")).toEqual(EACH_ONCE);
      expect(await deletionsOf("collection", "pages")).toEqual({});
      expect(await captures()).toBe(0);
    }, 180_000);

    it.each(["files recorded", "collection posts: recorded deletion events"])(
      "finishes, with nothing pending, a run stopped at %s, with no event twice",
      async at => {
        dropBoth();
        const stopped = await migrate(bothConsent(), point => {
          if (point === at) throw new Error(`stopped at ${at}`);
        }).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(stopped).toBeDefined();
        // The file is recorded and its tables gone; the events wait, captured.
        expect(await adapter.tableExists(posts)).toBe(false);
        expect(await captures()).toBeGreaterThan(0);
        expect(await deletionsOf("collection", "posts")).toEqual({});
        const recorded = await ledger();
        // A document deleted on its own since the capture, as another instance can on MySQL
        // between the capture and the drop: its event already names it.
        await adapter.insert("nextly_content_events", {
          id: randomUUID(),
          subjectKind: "collection",
          subjectSlug: "posts",
          subjectId: "e1",
          kind: "deleted",
          actorKind: "system",
          occurredAt: new Date(),
        });

        const finished = await migrate();

        expect(finished.applied).toBe(0);
        expect(await ledger()).toBe(recorded);
        expect(await deletionsOf("collection", "posts")).toEqual(EACH_ONCE);
        expect(await deletionsOf("single", "home")).toEqual(EACH_ONCE);
        expect(await captures()).toBe(0);
      },
      180_000
    );

    it("removes nothing when the run stops inside the file, and records each event once when it applies", async () => {
      // On MySQL each drop commits as it runs; the attempt's resolution is the runner's own test.
      if (dialect === "mysql") return;
      const name = dropBoth();
      const stopped = await migrate(bothConsent(), point => {
        if (point === `${name}: after statement 5`) throw new Error("stopped");
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(stopped).toBeDefined();
      // The file rolled back, the capture with it.
      expect(await adapter.tableExists(posts)).toBe(true);
      expect(await captures()).toBe(0);
      expect(await deletionsOf("collection", "posts")).toEqual({});

      const finished = await migrate(bothConsent());

      expect(finished.applied).toBe(1);
      expect(await deletionsOf("collection", "posts")).toEqual(EACH_ONCE);
      expect(await deletionsOf("single", "home")).toEqual(EACH_ONCE);
    }, 180_000);

    it("refuses a drop of a collection another one's field still names, removing nothing", async () => {
      // `pages` relates to `posts`: dropping `posts` would leave its field pointing at nothing.
      await adapter.delete("dynamic_collections", {
        and: [{ column: "slug", op: "=", value: "pages" }],
      });
      await register("collection", "pages", pages, `${pages}_refs`, [
        { name: "post", type: "relationship", options: { target: "posts" } },
      ]);
      file([
        `DROP TABLE ${posts}_tags`,
        `DROP TABLE ${posts}_locales`,
        `DROP TABLE ${posts}`,
      ]);
      const before = await ledger();

      const refused = await migrate(
        resolveDataLossConsent({ flag: posts, env: {} })
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(String((refused as Error | undefined)?.message)).toMatch(/posts/);
      expect(await adapter.tableExists(posts)).toBe(true);
      expect(await ledger()).toBe(before);
      expect(await captures()).toBe(0);
      expect(await deletionsOf("collection", "posts")).toEqual({});
    }, 180_000);
  }
);
