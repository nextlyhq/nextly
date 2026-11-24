/**
 * A migration that drops a collection or Single removed from code ends every one of its documents
 * with exactly one deletion event, on PostgreSQL, MySQL and SQLite, whether `migrate:create` wrote
 * the drop or a person did, and however the run stopped after the drop.
 *
 * Hand-written files here: one creates a translated collection and a translated Single, each with
 * a junction, and a collection that stays; a later one drops the first two. The documents of the
 * two are captured before the drop, in the file's transaction, and their deletion events recorded
 * once the file is recorded applied, in rows of at most 500 ids. A run stopped once the files
 * are recorded, or while it records the events, is finished by the next with nothing pending and
 * no event twice, as a real process killed there is; one stopped inside the file (PostgreSQL and
 * SQLite) removes nothing, and the next run applies the file whole. A table rebuilt in place, a
 * file run outside a transaction, a table renamed by an earlier file of the run, an id reused in a
 * second retirement in one run, and a DOWN's drop under `migrate:down` are covered too.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { captureRetiredDocuments } from "../../../domains/schema/migrate/retired-documents";
import {
  KILL_AT_VARIABLE,
  KILLED_AT,
  withStopPoints,
} from "../../../domains/schema/migrate/stop-points";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";
import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";
import { downDatabaseDeps } from "../migrate-down";

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

    /**
     * A hand-written migration file, after the ones before it, with no snapshot; run outside a
     * transaction where `noTransaction` says, its DOWN made of `down`.
     */
    function file(
      up: string[],
      noTransaction = false,
      down: string[] = []
    ): string {
      seq += 1;
      const name = `20261120_${String(seq).padStart(6, "0")}_${P}`;
      writeFileSync(
        join(migrationsDir, `${name}.sql`),
        `${noTransaction ? "-- nextly:no-transaction\n" : ""}-- Migration: ${name}\n\n-- UP\n${up.map(s => `${s};`).join("\n")}\n\n-- DOWN\n${down.map(s => `${s};`).join("\n")}\n`,
        "utf8"
      );
      return `${name}.sql`;
    }

    /** The statements dropping both entities: junctions, then translation tables, then main tables. */
    const BOTH_DROPPED = [
      `DROP TABLE ${posts}_tags`,
      `DROP TABLE ${home}_links`,
      `DROP TABLE ${posts}_locales`,
      `DROP TABLE ${home}_locales`,
      `DROP TABLE ${posts}`,
      `DROP TABLE ${home}`,
    ];

    /** The migration that drops both entities. */
    function dropBoth(noTransaction = false): string {
      return file(BOTH_DROPPED, noTransaction);
    }

    /** The statements dropping `posts` alone. */
    const POSTS_DROPPED = [
      `DROP TABLE ${posts}_tags`,
      `DROP TABLE ${posts}_locales`,
      `DROP TABLE ${posts}`,
    ];

    /** `pages` registered again with a relationship field naming `posts`. */
    async function pagesNamePosts() {
      await adapter.delete("dynamic_collections", {
        and: [{ column: "slug", op: "=", value: "pages" }],
      });
      await register("collection", "pages", pages, `${pages}_refs`, [
        { name: "post", type: "relationship", options: { target: "posts" } },
      ]);
    }

    /** A `deleted` event of `posts`' document `id`, as a delete recorded at `occurredAt`. */
    async function postDeleted(id: string, occurredAt: Date) {
      await adapter.insert("nextly_content_events", {
        id: randomUUID(),
        subjectKind: "collection",
        subjectSlug: "posts",
        subjectId: id,
        kind: "deleted",
        actorKind: "system",
        occurredAt,
      });
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

    /** The capture rows waiting in `nextly_meta`. */
    async function captures(): Promise<number> {
      return (await captureRows()).length;
    }

    /** Each capture row waiting in `nextly_meta`, with how many ids it holds. */
    async function captureRows(): Promise<{ key: string; ids: number }[]> {
      const rows = await adapter.select<{ key: string; value: unknown }>(
        "nextly_meta",
        {}
      );
      return rows
        .filter(row => row.key.startsWith("retired_documents:"))
        .map(row => {
          const value = (
            typeof row.value === "string" ? JSON.parse(row.value) : row.value
          ) as { ids?: unknown[] };
          return { key: row.key, ids: value.ids?.length ?? 0 };
        });
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
      // `e2` of `posts` was deleted once before, in a life of its own that ended long ago: its
      // retirement ends the life it has now with an event of its own.
      await postDeleted("e2", new Date(Date.now() - 86_400_000));
      dropBoth();
      const run = await migrate(bothConsent());

      expect(run.applied).toBe(1);
      expect(await deletionsOf("collection", "posts")).toEqual({
        e1: 1,
        e2: 2,
      });
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
        // between the capture and the drop, by a host whose clock runs an hour behind this one's:
        // its event already names it, whenever it says it happened.
        await postDeleted("e1", new Date(Date.now() - 3_600_000));

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

    it("keeps every row of ids within a row's size, and finishes a run stopped between rows", async () => {
      // The most ids a stored row may hold, as the capture promises it.
      const ROW = 500;
      // `posts` holds more documents than two rows of ids.
      const many = Array.from(
        { length: 2 * ROW + 1 },
        (_, n) => `m${String(n).padStart(5, "0")}`
      );
      for (let at = 0; at < many.length; at += 100) {
        const values = many
          .slice(at, at + 100)
          .map(id => `('${id}', 'm')`)
          .join(", ");
        await adapter.executeQuery(
          `INSERT INTO ${posts} (id, title) VALUES ${values}`
        );
      }
      dropBoth();
      let rows = 0;
      const stopped = await migrate(bothConsent(), point => {
        // Stopped in the second row's transaction: the first row's events are in.
        if (point === "collection posts: recorded deletion events") {
          rows += 1;
          if (rows === 2) throw new Error("stopped");
        }
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(stopped).toBeDefined();
      const stored = await captureRows();
      expect(Math.max(...stored.map(row => row.ids))).toBeLessThanOrEqual(ROW);
      expect(
        Object.keys(await deletionsOf("collection", "posts"))
      ).toHaveLength(ROW);

      await migrate();

      // Every document, each once, and no other.
      expect(await deletionsOf("collection", "posts")).toEqual(
        Object.fromEntries(["e1", "e2", ...many].map(id => [id, 1]))
      );
      expect(await deletionsOf("single", "home")).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }, 300_000);

    it("leaves a table rebuilt in place, and what names it, as they are: nothing is retired", async () => {
      // `pages` names `posts`; a rebuild of `posts` keeps it.
      await pagesNamePosts();
      file([
        `CREATE TABLE ${posts}_rebuilt (id varchar(36) PRIMARY KEY, title varchar(64))`,
        `INSERT INTO ${posts}_rebuilt (id, title) SELECT id, title FROM ${posts}`,
        `DROP TABLE ${posts}`,
        `ALTER TABLE ${posts}_rebuilt RENAME TO ${posts}`,
      ]);

      const run = await migrate(bothConsent());

      expect(run.applied).toBe(1);
      expect(await adapter.tableExists(posts)).toBe(true);
      expect(await deletionsOf("collection", "posts")).toEqual({});
      expect(await captures()).toBe(0);
    }, 180_000);

    it("ends each document once when the dropping file runs outside a transaction", async () => {
      dropBoth(true);

      const run = await migrate(bothConsent());

      expect(run.applied).toBe(1);
      expect(await deletionsOf("collection", "posts")).toEqual(EACH_ONCE);
      expect(await deletionsOf("single", "home")).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }, 180_000);

    it("ends each document once when an earlier file of the run renamed the table a later one drops", async () => {
      file([`ALTER TABLE ${posts} RENAME TO ${posts}_old`]);
      file([
        `DROP TABLE ${posts}_tags`,
        `DROP TABLE ${posts}_locales`,
        `DROP TABLE ${posts}_old`,
      ]);

      const run = await migrate(
        resolveDataLossConsent({ flag: `${posts},${posts}_old`, env: {} })
      );

      expect(run.applied).toBe(2);
      expect(await deletionsOf("collection", "posts")).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }, 180_000);

    it("ends each life of a document once when one run retires an entity twice, its id reused", async () => {
      file(POSTS_DROPPED);
      file([
        `CREATE TABLE ${posts} (id varchar(36) PRIMARY KEY, title varchar(64))`,
        `INSERT INTO ${posts} (id, title) VALUES ('e1', 'again')`,
      ]);
      file([`DROP TABLE ${posts}`]);

      const run = await migrate(
        resolveDataLossConsent({ flag: posts, env: {} })
      );

      expect(run.applied).toBe(3);
      expect(await deletionsOf("collection", "posts")).toEqual({
        e1: 2,
        e2: 1,
      });
      expect(await captures()).toBe(0);
    }, 180_000);

    /** `nextly_content_events` renamed away, so no event can be written, and back. */
    const eventsAway = () =>
      adapter.executeQuery(
        `ALTER TABLE nextly_content_events RENAME TO ${P}_events_away`
      );
    const eventsBack = () =>
      adapter.executeQuery(
        `ALTER TABLE ${P}_events_away RENAME TO nextly_content_events`
      );

    /**
     * A capture stored as the run stores one (`retired-documents.ts`), for `head`, holding `ids`;
     * answers its keys.
     */
    async function storeCapture(
      head: {
        file: string;
        kind: "collection" | "single";
        slug: string;
        table: string;
        direction: "up" | "down";
        seq: number;
      },
      ids: string[]
    ): Promise<string[]> {
      const hash = (text: string) =>
        createHash("sha256").update(text).digest("hex").slice(0, 32);
      const prefix = `retired_documents:${hash(head.file)}:${hash(`${head.kind}:${head.slug}:${head.direction}`)}:`;
      for (const [key, value] of [
        [`${prefix}head`, head],
        [`${prefix}0`, { ids, deletions: {} }],
      ] as const) {
        await adapter.insert("nextly_meta", {
          key,
          value: JSON.stringify(value),
          updatedAt: new Date(),
        });
      }
      return [`${prefix}head`, `${prefix}0`];
    }

    it("captures a quoted mixed-case table under the spelling the catalog holds", async () => {
      // Only PostgreSQL keeps a quoted name's case apart.
      if (dialect !== "postgresql") return;
      const mixed = `${P}_Mixed`;
      file([
        `CREATE TABLE "${mixed}" (id varchar(36) PRIMARY KEY, title varchar(64))`,
        `INSERT INTO "${mixed}" (id, title) VALUES ('q1', 'a')`,
      ]);
      expect((await migrate()).applied).toBe(1);
      await register("collection", "mixed", mixed, `${P}_mixed_links`);
      file([`DROP TABLE "${mixed}"`]);

      // The consent names the table by both spellings, as `nextly migrate` asks for it.
      const run = await migrate(
        resolveDataLossConsent({
          flag: `${mixed},${mixed.toLowerCase()}`,
          env: {},
        })
      );

      expect(run.applied).toBe(1);
      expect(await deletionsOf("collection", "mixed")).toEqual({ q1: 1 });
      expect(await captures()).toBe(0);
    }, 180_000);

    it("retires only the table a quoted drop spells, not one differing only in case", async () => {
      // Only PostgreSQL keeps a quoted name's case apart.
      if (dialect !== "postgresql") return;
      const upper = `${P}_Case`;
      const lower = `${P}_case`;
      await adapter.executeQuery(
        `CREATE TABLE "${upper}" (id varchar(36) PRIMARY KEY)`
      );
      await adapter.executeQuery(
        `CREATE TABLE ${lower} (id varchar(36) PRIMARY KEY)`
      );
      await register("collection", "upper", upper, `${upper}_links`);
      // `lower` stays, and names `upper`.
      await register("collection", "lower", lower, `${lower}_links`, [
        { name: "up", type: "relationship", options: { target: "upper" } },
      ]);

      await expect(
        judge([{ label: "x.sql", statements: [`DROP TABLE "${upper}"`] }])
      ).rejects.toThrow(/upper/);
    }, 180_000);

    it("settles the captures of other entities when one cannot be recorded, keeping that one", async () => {
      const name = dropBoth();
      const stopped = await migrate(bothConsent(), point => {
        if (point === "files recorded") throw new Error("stopped");
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(stopped).toBeDefined();
      // Taken first, and its event refused: a slug longer than an event holds.
      await storeCapture(
        {
          file: name,
          kind: "collection",
          slug: "x".repeat(600),
          table: `${P}_gone`,
          direction: "up",
          seq: 0,
        },
        ["z1"]
      );

      await migrate();

      expect(await deletionsOf("collection", "posts")).toEqual(EACH_ONCE);
      expect(await deletionsOf("single", "home")).toEqual(EACH_ONCE);
      // The one that failed waits for the next run.
      expect(await captures()).toBe(2);
    }, 180_000);

    it("captures nothing where nextly_meta is not there", async () => {
      await adapter.executeQuery("DROP TABLE nextly_meta");

      await expect(
        captureRetiredDocuments(
          adapter.getDrizzle(),
          dialect,
          {
            source: "x.sql",
            transaction: true,
            retirements: { renamedBefore: new Map() },
          },
          POSTS_DROPPED,
          0,
          false
        )
      ).resolves.toBeUndefined();
    }, 180_000);

    it("captures nothing blindly: a registry that is there but cannot be read fails the capture", async () => {
      await adapter.executeQuery(
        `ALTER TABLE dynamic_collections RENAME COLUMN table_name TO ${P}_unread`
      );
      try {
        await expect(
          captureRetiredDocuments(
            adapter.getDrizzle(),
            dialect,
            {
              source: "x.sql",
              transaction: true,
              retirements: { renamedBefore: new Map() },
            },
            POSTS_DROPPED,
            0,
            false
          )
        ).rejects.toThrow();
      } finally {
        await adapter.executeQuery(
          `ALTER TABLE dynamic_collections RENAME COLUMN ${P}_unread TO table_name`
        );
      }
    }, 180_000);

    it("retires a mixed-case table only where its own spelling is dropped and not made again", async () => {
      // Only PostgreSQL keeps a quoted name's case apart.
      if (dialect !== "postgresql") return;
      const upper = `${P}_Spell`;
      await adapter.executeQuery(
        `CREATE TABLE "${upper}" (id varchar(36) PRIMARY KEY)`
      );
      await register("collection", "spell", upper, `${upper}_links`);
      // `pages` names it.
      await adapter.delete("dynamic_collections", {
        and: [{ column: "slug", op: "=", value: "pages" }],
      });
      await register("collection", "pages", pages, `${pages}_refs`, [
        { name: "spell", type: "relationship", options: { target: "spell" } },
      ]);

      // Another schema's table of that spelling.
      await expect(
        judge([
          {
            label: "x.sql",
            statements: [`DROP TABLE IF EXISTS archive."${upper}"`],
          },
        ])
      ).resolves.toBeUndefined();
      // Rebuilt in place, beside an unrelated drop.
      await expect(
        judge([
          {
            label: "x.sql",
            statements: [
              `CREATE TABLE "${upper}_new" (id varchar(36) PRIMARY KEY)`,
              `DROP TABLE "${upper}"`,
              `ALTER TABLE "${upper}_new" RENAME TO "${upper}"`,
              `DROP TABLE IF EXISTS ${P}_unrelated`,
            ],
          },
        ])
      ).resolves.toBeUndefined();
    }, 180_000);

    it("keeps the capture of a quoted mixed-case table while a lower-case one of its name stands", async () => {
      // Only PostgreSQL keeps a quoted name's case apart.
      if (dialect !== "postgresql") return;
      const upper = `${P}_Twin`;
      file([
        `CREATE TABLE "${upper}" (id varchar(36) PRIMARY KEY, title varchar(64))`,
        `CREATE TABLE ${upper.toLowerCase()} (id varchar(36) PRIMARY KEY)`,
        `INSERT INTO "${upper}" (id, title) VALUES ('t1', 'a')`,
      ]);
      expect((await migrate()).applied).toBe(1);
      await register("collection", "twin", upper, `${upper}_links`);
      file([`DROP TABLE "${upper}"`]);

      const run = await migrate(
        resolveDataLossConsent({
          flag: `${upper},${upper.toLowerCase()}`,
          env: {},
        })
      );

      expect(run.applied).toBe(1);
      expect(await deletionsOf("collection", "twin")).toEqual({ t1: 1 });
      expect(await captures()).toBe(0);
    }, 180_000);

    /**
     * `nextly migrate` as a real process over this database, as a deploy runs it, killing itself at
     * `killAt` where one is named (`stop-points.ts`). Each run clears the lock a killed one left.
     */
    function migrateProcess(killAt?: string) {
      return nextlyProcess(
        [
          "migrate",
          `--accept-data-loss=${posts},${home}`,
          "--non-interactive",
          "--force-unlock",
        ],
        killAt
      );
    }

    /** `nextly <args>` as a real process over this database, killing itself at `killAt` if named. */
    function nextlyProcess(args: string[], killAt?: string) {
      const project = mkdtempSync(join(tmpdir(), "nextly-retire-project-"));
      writeFileSync(
        join(project, "nextly.config.ts"),
        `export default ${JSON.stringify({
          collections: [],
          db: { migrationsDir },
        })};\n`
      );
      const url =
        dialect === "sqlite" && !world.url.startsWith("file:")
          ? `file:${world.url}`
          : world.url;
      return runNextly(
        args,
        project,
        {
          DATABASE_URL: url,
          DB_DIALECT: dialect,
          NODE_ENV: "test",
          [KILL_AT_VARIABLE]: killAt,
        },
        PROCESS_TIMEOUT
      ).finally(() => rmSync(project, { recursive: true, force: true }));
    }

    /** How long one real process may take: each compiles the CLI, on a machine other runs share. */
    const PROCESS_TIMEOUT = 2.5 * NEXTLY_RUN_TIMEOUT;

    it(
      "finishes, with nothing pending, a run whose process was killed after the files were recorded",
      async () => {
        // The database's first run is recorded first, so the drop meets Phase 3 itself.
        const first = await migrateProcess();
        expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
        dropBoth();
        let recorded: number | undefined;
        for (const at of [
          "files recorded",
          "collection posts: recorded deletion events",
        ]) {
          const killed = await migrateProcess(at);
          const seen = `${at}\n${killed.stdout}\n${killed.stderr}`;
          // Killed at the point named, not ended any other way.
          expect(killed.stderr, seen).toContain(`${KILLED_AT}${at}\n`);
          // Killed with the file recorded: its tables gone, no event recorded, no ledger row added.
          expect(await adapter.tableExists(posts), seen).toBe(false);
          expect(await deletionsOf("collection", "posts"), seen).toEqual({});
          recorded ??= await ledger();
          expect(await ledger(), seen).toBe(recorded);
        }

        const finished = await migrateProcess();
        const seen = `${finished.stdout}\n${finished.stderr}`;
        expect(finished.status, seen).toBe(0);
        expect(await deletionsOf("collection", "posts"), seen).toEqual(
          EACH_ONCE
        );
        expect(await deletionsOf("single", "home"), seen).toEqual(EACH_ONCE);
        expect(await captures(), seen).toBe(0);
        expect(await ledger(), seen).toBe(recorded);
      },
      4 * PROCESS_TIMEOUT
    );

    it(
      "removes nothing when the process is killed inside the file, and records each event once on the first run that applies it",
      async () => {
        // On MySQL each drop commits as it runs; the attempt's resolution is the runner's own test.
        if (dialect === "mysql") return;
        const name = dropBoth();
        const killed = await migrateProcess(`${name}: after statement 5`);
        const said = `${killed.stdout}\n${killed.stderr}`;
        expect(killed.stderr, said).toContain(
          `${KILLED_AT}${name}: after statement 5\n`
        );
        // The file rolled back, the capture with it.
        expect(await adapter.tableExists(posts), said).toBe(true);
        expect(await captures(), said).toBe(0);

        // The database's first run: its commit writes the registry, then the events go.
        const finished = await migrateProcess();
        const seen = `${finished.stdout}\n${finished.stderr}`;
        expect(finished.status, seen).toBe(0);
        expect(await adapter.tableExists(posts), seen).toBe(false);
        expect(await deletionsOf("collection", "posts"), seen).toEqual(
          EACH_ONCE
        );
        expect(await deletionsOf("single", "home"), seen).toEqual(EACH_ONCE);
        expect(await captures(), seen).toBe(0);
      },
      2 * PROCESS_TIMEOUT
    );

    /** A collection, `extra`, whose file's DOWN drops it. */
    const extra = `${P}_extra`;
    const EXTRA_DOWN = [`DROP TABLE ${extra}_links`, `DROP TABLE ${extra}`];

    /** `extra`'s file, applied, with `extra` registered and two documents; answers its name. */
    async function extraApplied(): Promise<string> {
      const name = file(
        [
          `CREATE TABLE ${extra} (id varchar(36) PRIMARY KEY, title varchar(64))`,
          `CREATE TABLE ${extra}_links (id varchar(36) PRIMARY KEY, source_id varchar(36), target_id varchar(36))`,
          `INSERT INTO ${extra} (id, title) VALUES ('x1', 'a'), ('x2', 'b')`,
        ],
        false,
        EXTRA_DOWN
      );
      expect((await migrate()).applied).toBe(1);
      await register("collection", "extra", extra, `${extra}_links`);
      return name;
    }

    it("reports a DOWN rolled back when its events fail after its commit, and the next run records them", async () => {
      const name = await extraApplied();
      const deps = await downDatabaseDeps({ adapter, dialect, logger });

      const ran = await withStopPoints(
        point => {
          if (point === "collection extra: recorded deletion events") {
            throw new Error("stopped");
          }
        },
        () =>
          deps.execDown(
            EXTRA_DOWN,
            { source: name, transaction: true, direction: "down" },
            async handle => {
              await deps.recordRolledBack(name, handle);
            }
          )
      );

      expect(ran).toBe(EXTRA_DOWN.length);
      expect(await adapter.tableExists(extra)).toBe(false);
      expect(await deletionsOf("collection", "extra")).toEqual({});
      expect(await captures()).toBeGreaterThan(0);

      // The next run records them before it applies the file again.
      await migrate();

      expect(await deletionsOf("collection", "extra")).toEqual({
        x1: 1,
        x2: 1,
      });
      expect(await captures()).toBe(0);
    }, 180_000);

    it("refuses to roll back while an UP's capture cannot be recorded", async () => {
      dropBoth();
      const stopped = await migrate(bothConsent(), point => {
        if (point === "files recorded") throw new Error("stopped");
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(stopped).toBeDefined();
      // With no logger, as a plugin's uninstall rolls back: the settling is there all the same.
      const deps = await downDatabaseDeps({ adapter, dialect });
      expect(deps.settleRetirements).toBeDefined();

      await eventsAway();
      try {
        await expect(deps.settleRetirements?.()).rejects.toThrow();
      } finally {
        await eventsBack();
      }
      expect(await captures()).toBeGreaterThan(0);
    }, 180_000);

    it("applies no file again while a DOWN's capture cannot be recorded", async () => {
      const name = await extraApplied();
      const deps = await downDatabaseDeps({ adapter, dialect, logger });
      // The DOWN commits; its events wait, captured.
      await withStopPoints(
        point => {
          if (point === "collection extra: recorded deletion events") {
            throw new Error("stopped");
          }
        },
        () =>
          deps.execDown(
            EXTRA_DOWN,
            { source: name, transaction: true, direction: "down" },
            async handle => {
              await deps.recordRolledBack(name, handle);
            }
          )
      );
      // A DOWN's capture taken before it, whose event cannot be written: a slug longer than an
      // event holds.
      const stuck = await storeCapture(
        {
          file: name,
          kind: "collection",
          slug: "x".repeat(600),
          table: `${P}_gone`,
          direction: "down",
          seq: 0,
        },
        ["z1"]
      );

      await expect(migrate()).rejects.toThrow(/could not be recorded/);
      expect(await adapter.tableExists(extra)).toBe(false);

      for (const key of stuck) {
        await adapter.delete("nextly_meta", {
          and: [{ column: "key", op: "=", value: key }],
        });
      }
      await migrate();

      expect(await adapter.tableExists(extra)).toBe(true);
      expect(await deletionsOf("collection", "extra")).toEqual({
        x1: 1,
        x2: 1,
      });
    }, 180_000);

    it(
      "ends each document of an entity a DOWN drops once migrate:down commits it",
      async () => {
        await extraApplied();

        const down = await nextlyProcess([
          "migrate:down",
          "--step",
          "1",
          "--accept-data-loss",
          "--non-interactive",
          "--force-unlock",
        ]);

        const said = `${down.stdout}\n${down.stderr}`;
        expect(down.status, said).toBe(0);
        expect(await adapter.tableExists(extra), said).toBe(false);
        expect(await deletionsOf("collection", "extra"), said).toEqual({
          x1: 1,
          x2: 1,
        });
        expect(await captures(), said).toBe(0);
      },
      2 * PROCESS_TIMEOUT
    );

    it(
      "records an UP's events before migrate:down rolls its file back and makes the table again",
      async () => {
        file(POSTS_DROPPED, false, [
          `CREATE TABLE ${posts} (id varchar(36) PRIMARY KEY, title varchar(64))`,
        ]);
        // The UP applied and recorded, its events not yet.
        const stopped = await migrate(
          resolveDataLossConsent({ flag: posts, env: {} }),
          point => {
            if (point === "files recorded") throw new Error("stopped");
          }
        ).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(stopped).toBeDefined();
        expect(await captures()).toBeGreaterThan(0);

        const down = await nextlyProcess([
          "migrate:down",
          "--step",
          "1",
          "--accept-data-loss",
          "--non-interactive",
          "--force-unlock",
        ]);

        const said = `${down.stdout}\n${down.stderr}`;
        expect(down.status, said).toBe(0);
        expect(await adapter.tableExists(posts), said).toBe(true);
        expect(await deletionsOf("collection", "posts"), said).toEqual(
          EACH_ONCE
        );
        expect(await captures(), said).toBe(0);
      },
      2 * PROCESS_TIMEOUT
    );
  }
);
