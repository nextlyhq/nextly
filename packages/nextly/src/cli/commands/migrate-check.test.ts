// F11 PR 4: unit tests for `nextly migrate:check`.
//
// Tests the pure `runChecks` helper directly with a tmp `migrations/`
// directory + a hand-built desired snapshot. The CLI entry point
// (`runMigrateCheck`) is a thin wrapper that loads config + dialect
// then delegates to `runChecks`; covering the helper covers the
// behavioural surface without dragging loadConfig + module-resolution
// machinery into the test.
//
// Drives all five outcomes:
//   - clean state -> exit 0, success log
//   - CHECKSUM_MISMATCH -> exit 1
//   - MISSING_SNAPSHOT -> exit 1
//   - MISSING_MIGRATION -> exit 1
//   - SCHEMA_DRIFT -> exit 1
//
// Plus assertion that the runChecks helper does NOT call createAdapter
// (verified at the top of this file via the absence of any adapter
// import; eslint's no-unused-imports would catch a dangling one).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settingsOf } from "../../domains/schema/migrate-create/entity-settings";
import type { MinimalConfigField } from "../../domains/schema/migrate-create/generate";
import { writeSnapshot } from "../../domains/schema/migrate-create/snapshot-io";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";

import { runChecks } from "./migrate-check";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    header: vi.fn(),
    newline: vi.fn(),
    divider: vi.fn(),
    keyValue: vi.fn(),
    item: vi.fn(),
    table: vi.fn(),
    getOptions: () => ({}),
  };
}

const POSTS_TABLE = {
  name: "dc_posts",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "created_at", type: "timestamp", nullable: true },
    { name: "description", type: "text", nullable: false },
    { name: "slug", type: "text", nullable: false },
    { name: "title", type: "text", nullable: false },
    { name: "updated_at", type: "timestamp", nullable: true },
  ],
};

const POSTS_DESIRED: NextlySchemaSnapshot = { tables: [POSTS_TABLE] };
const EMPTY_DESIRED: NextlySchemaSnapshot = { tables: [] };

describe("runChecks (F11 PR 4)", () => {
  let migrationsDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  // The error a failing check ends with, printed on standard error in the error shape.
  let printed: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nextly-migrate-check-test-"));
    migrationsDir = join(cwd, "migrations");
    await mkdir(join(migrationsDir, "meta"), { recursive: true });
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    exitSpy.mockRestore();
    printed.mockRestore();
    // best-effort cleanup; OS will reap tmpdir anyway
    await rm(migrationsDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("clean state", () => {
    it("exits 0 with success log when files match snapshot and config has no drift", async () => {
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        POSTS_DESIRED,
        sqlContent
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("migrate:check OK")
      );
    });

    it("exits 0 when the config carries the per-document columns a snapshot from before them lacks", async () => {
      // A site's latest snapshot predates the version counter and the last
      // changer, while the config now declares them on every content table.
      // `nextly migrate` adds them itself, so this is no schema drift.
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        POSTS_DESIRED,
        sqlContent
      );
      const withDocumentColumns: NextlySchemaSnapshot = {
        tables: [
          {
            ...POSTS_TABLE,
            columns: [
              ...POSTS_TABLE.columns,
              {
                name: "_revision",
                type: "int4",
                nullable: false,
                default: "1",
              },
              { name: "_changed_by_kind", type: "varchar", nullable: true },
              { name: "_changed_by_id", type: "text", nullable: true },
              {
                name: "_changed_by_principal_kind",
                type: "varchar",
                nullable: true,
              },
              { name: "_changed_at", type: "timestamp", nullable: true },
            ],
          },
        ],
      };

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: withDocumentColumns,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("migrate:check OK")
      );
    });

    it("exits 0 when there are zero migration files and config matches EMPTY_SNAPSHOT", async () => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });
      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("migrate:check OK")
      );
    });
  });

  describe("statements a run would refuse", () => {
    /** A generated-looking file with its paired snapshot, so it passes the
     * integrity checks and only the statement check has anything to say. */
    async function writeGenerated(
      name: string,
      content: string,
      // The schema as the file leaves it; empty unless a test needs tables.
      snapshot: NextlySchemaSnapshot = EMPTY_DESIRED
    ) {
      await writeFile(join(migrationsDir, `${name}.sql`), content, "utf-8");
      await writeSnapshot(join(migrationsDir, "meta"), name, snapshot, content);
    }

    // The dialect and desired schema default to PostgreSQL with no tables; a
    // SQLite rebuild test passes its own, the desired one matching the latest
    // snapshot so no drift is reported.
    const run = async (
      dialect: "postgresql" | "sqlite" = "postgresql",
      desiredSnapshot: NextlySchemaSnapshot = EMPTY_DESIRED
    ) => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot,
        dialect,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });
      return logger;
    };

    /** The `notes` table with the given columns, as a snapshot records it. */
    const notesWith = (...columns: string[]): NextlySchemaSnapshot => ({
      tables: [
        {
          name: "notes",
          columns: columns.map(name =>
            name === "id"
              ? { name, type: "integer", nullable: false, primaryKey: true }
              : { name, type: "text", nullable: true }
          ),
        },
      ],
    });

    /** A SQLite file creating `notes` with id, title and body. */
    const createNotes = () =>
      writeGenerated(
        "20260101_120000_001_notes",
        '-- UP\nCREATE TABLE "notes" ("id" integer PRIMARY KEY NOT NULL, "title" text, "body" text);\n\n-- DOWN\n',
        notesWith("id", "title", "body")
      );

    /** A SQLite rebuild of `notes` whose twin declares and copies `columns`. */
    const rebuildNotes = (columns: string[]) => {
      const declared = columns
        .map(name =>
          name === "id"
            ? '"id" integer PRIMARY KEY NOT NULL'
            : `"${name}" text NOT NULL`
        )
        .join(", ");
      const listed = columns.map(name => `"${name}"`).join(", ");
      return (
        `-- UP\nCREATE TABLE "__new_notes" (${declared});\n` +
        `INSERT INTO "__new_notes" (${listed}) SELECT ${listed} FROM "notes";\n` +
        `DROP TABLE "notes";\n` +
        `ALTER TABLE "__new_notes" RENAME TO "notes";\n\n-- DOWN\n`
      );
    };

    it("names the column a SQLite rebuild leaves out, read from the snapshot before the file", async () => {
      await createNotes();
      await writeGenerated(
        "20260101_120000_002_drop_body",
        rebuildNotes(["id", "title"]),
        notesWith("id", "title")
      );
      const logger = await run("sqlite", notesWith("id", "title"));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /DESTRUCTIVE: 20260101_120000_002_drop_body\.sql \(UP\) deletes data: column notes\.body\. nextly migrate runs it only with --accept-data-loss/
        )
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("reports nothing for a SQLite rebuild that carries every column", async () => {
      await createNotes();
      await writeGenerated(
        "20260101_120000_002_tighten",
        rebuildNotes(["id", "title", "body"]),
        notesWith("id", "title", "body")
      );
      const logger = await run("sqlite", notesWith("id", "title", "body"));
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("DESTRUCTIVE")
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("warns about a statement nextly migrate would refuse, without failing", async () => {
      await writeGenerated(
        "20260101_120000_001_index",
        "-- UP\nCREATE INDEX CONCURRENTLY i ON t (a);\n\n-- DOWN\n"
      );
      const logger = await run();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /REFUSED_STATEMENT: 20260101_120000_001_index\.sql: .*-- nextly:no-transaction/
        )
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("reports a call to a function a migration file defines as DESTRUCTIVE, and leaves a built-in to the run", async () => {
      await writeGenerated(
        "20260101_120000_001_function",
        "-- UP\nCREATE FUNCTION purge_old() RETURNS void AS $$ DELETE FROM t $$ LANGUAGE sql;\n\n-- DOWN\nDROP FUNCTION purge_old();\n"
      );
      await writeGenerated(
        "20260101_120000_002_call",
        "-- UP\nSELECT purge_old();\nSELECT count(*) FROM t;\n\n-- DOWN\n"
      );
      const logger = await run();
      const warned = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(
        ([line]) => String(line)
      );
      const destructive = warned.filter(line => line.includes("DESTRUCTIVE"));
      expect(destructive).toEqual([
        expect.stringMatching(
          /DESTRUCTIVE: 20260101_120000_002_call\.sql \(UP\) deletes data: SELECT PURGE_OLD \(calls a function, may delete data\)\./
        ),
      ]);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("reports a file that deletes data as DESTRUCTIVE, naming each deletion per section, without failing", async () => {
      await writeGenerated(
        "20260101_120000_001_drop",
        "-- UP\nDROP TABLE t;\n\n-- DOWN\nDELETE FROM u WHERE a = 1;\n"
      );
      const logger = await run();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /DESTRUCTIVE: 20260101_120000_001_drop\.sql \(UP\) deletes data: table t\. nextly migrate runs it only with --accept-data-loss/
        )
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /DESTRUCTIVE: 20260101_120000_001_drop\.sql \(DOWN\) deletes data: rows of u\. migrate:down runs it only with --accept-data-loss/
        )
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("names a marked file and lets its statement through", async () => {
      await writeGenerated(
        "20260101_120000_001_index",
        "-- nextly:no-transaction\n-- UP\nCREATE INDEX CONCURRENTLY i ON t (a);\n\n-- DOWN\nDROP INDEX CONCURRENTLY i;\n"
      );
      const logger = await run();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "20260101_120000_001_index.sql is marked -- nextly:no-transaction"
        )
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("REFUSED_STATEMENT")
      );
    });
  });

  describe("a new address the rule refuses", () => {
    it("names it, then exits 1 through the error shape", async () => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        // `admin` is a reserved slug, and with no migrations yet it is new.
        entities: {
          collections: [{ slug: "admin", tableName: "dc_admin", fields: [] }],
          singles: [],
          components: [],
        },
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      // What the check says about the address is unchanged: the refusal and
      // what to do about it, on the command's log.
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/^SLUG_RESERVED: .*admin/)
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Give each refused address one the rule accepts"
        )
      );
      // Then it ends as every other failed check does: the error shape, here
      // the code migrate:create ends the same refusal with, and exit 1.
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(CONFIG_INVALID)")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.success).not.toHaveBeenCalled();
    });
  });

  describe("CHECKSUM_MISMATCH", () => {
    it("exits 1 when a .sql file is edited after generation", async () => {
      const original = "CREATE TABLE foo (id text);";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        original,
        "utf-8"
      );
      // Snapshot's migrationHash is computed from `original` ...
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        POSTS_DESIRED,
        original
      );
      // ... then we tamper with the SQL.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        original + " -- TAMPERED",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(CHECKSUM_MISMATCH)")
      );
    });
  });

  describe("MISSING_SNAPSHOT", () => {
    it("exits 1 when a .sql file has no paired snapshot", async () => {
      // SQL exists, but no snapshot in meta/.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_orphan.sql"),
        "CREATE TABLE foo (id text);",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(MISSING_SNAPSHOT)")
      );
    });
  });

  describe("INVALID_SNAPSHOT (F11 PR 4 review fix #3)", () => {
    it("exits 1 with INVALID_SNAPSHOT when a paired snapshot is malformed JSON", async () => {
      // .sql exists; paired snapshot exists but is invalid JSON.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        "CREATE TABLE foo (id text);",
        "utf-8"
      );
      await writeFile(
        join(
          migrationsDir,
          "meta",
          "20260101_120000_001_initial.snapshot.json"
        ),
        "{not valid json",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(INVALID_SNAPSHOT)")
      );
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("JSON parse failed")
      );
    });

    it("exits 1 with INVALID_SNAPSHOT when a snapshot has wrong version", async () => {
      // .sql exists; paired snapshot has version 2 (future format).
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        "CREATE TABLE foo (id text);",
        "utf-8"
      );
      await writeFile(
        join(
          migrationsDir,
          "meta",
          "20260101_120000_001_initial.snapshot.json"
        ),
        JSON.stringify({
          version: 2,
          migrationHash: "a".repeat(64),
          snapshot: { tables: [] },
        }),
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(INVALID_SNAPSHOT)")
      );
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("expected version: 1, got 2")
      );
    });
  });

  describe("MISSING_MIGRATION", () => {
    it("exits 1 when a snapshot has no paired .sql", async () => {
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_orphan_snapshot",
        POSTS_DESIRED,
        "anything"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(MISSING_MIGRATION)")
      );
    });
  });

  describe("SCHEMA_DRIFT", () => {
    it("exits 1 when config has uncommitted changes (no snapshots at all)", async () => {
      // Empty migrations + meta. desiredSnapshot has the posts table, so
      // the diff is non-empty (add_table dc_posts).
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(SCHEMA_DRIFT)")
      );
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("add_table dc_posts")
      );
    });

    it("exits 1 when config diverges from the latest snapshot", async () => {
      // Seed a snapshot with EMPTY tables; pass desiredSnapshot with posts.
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        EMPTY_DESIRED,
        sqlContent
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(SCHEMA_DRIFT)")
      );
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("Run `nextly migrate:create")
      );
    });

    it("caps drift output at 10 ops with a 'and X more' indicator", async () => {
      // Seed an empty snapshot; pass a desired snapshot with 15 tables to
      // produce 15 add_table ops.
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        EMPTY_DESIRED,
        sqlContent
      );

      const manyTables: NextlySchemaSnapshot = {
        tables: Array.from({ length: 15 }, (_, i) => ({
          name: `dc_t${i.toString().padStart(2, "0")}`,
          columns: [{ name: "id", type: "text", nullable: false }],
        })),
      };

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: manyTables,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("... and 5 more")
      );
    });
  });

  describe("addresses, by the one address rule", () => {
    const ADMIN_TABLE = { ...POSTS_TABLE, name: "dc_admin" };
    const entity = (slug: string, tableName: string) => ({
      slug,
      tableName,
      fields: [],
    });

    async function seed(snapshot: NextlySchemaSnapshot): Promise<void> {
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        snapshot,
        sqlContent
      );
    }

    it("warns once for an existing address the rule refuses, and passes", async () => {
      // A Builder collection made under `admin` before the rule: its table is in the snapshot.
      await seed({ tables: [ADMIN_TABLE] });

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: { tables: [ADMIN_TABLE] },
        entities: {
          collections: [entity("admin", "dc_admin")],
          singles: [],
          components: [],
        },
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).not.toHaveBeenCalledWith(1);
      const warnings = logger.warn.mock.calls
        .map(([line]) => String(line))
        .filter(line => line.includes("'admin'"));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/SLUG_RESERVED: .*'admin'.*keeps working/);
    });

    it("fails a new address the rule refuses, naming it and the reason, before the drift", async () => {
      await seed(POSTS_DESIRED);
      const CASCADE_TABLE = { ...POSTS_TABLE, name: "dc_cascade" };

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: { tables: [POSTS_TABLE, CASCADE_TABLE] },
        entities: {
          collections: [
            entity("posts", "dc_posts"),
            entity("cascade", "dc_cascade"),
          ],
          singles: [],
          components: [],
        },
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error.mock.calls[0]?.[0]).toMatch(
        /^SLUG_SQL_KEYWORD: Collection address 'cascade' is a reserved SQL word/
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(
          /the rule accepts\. If an entity already exists under it.*remove it from the configuration, create and apply the migration, then add it back under an accepted address/
        )
      );
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.stringContaining("SCHEMA_DRIFT")
      );
    });
  });

  describe("sibling fields, by the one sibling rule", () => {
    const text = (name: string): MinimalConfigField => ({ name, type: "text" });
    const seo = (names: string[]): MinimalConfigField => ({
      name: "seo",
      type: "group",
      fields: names.map(text),
    });
    const postsWith = (fields: MinimalConfigField[]) => ({
      slug: "posts",
      tableName: "dc_posts",
      fields,
    });

    /** The latest snapshot, recording `posts` with `fields` as declared. */
    async function seedRecording(fields: MinimalConfigField[]): Promise<void> {
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        POSTS_DESIRED,
        sqlContent,
        undefined,
        {
          collections: {
            posts: {
              source: "code",
              settings: settingsOf({ slug: "posts", fields }, "code"),
            },
          },
          singles: {},
          fieldGroups: {},
        }
      );
    }

    const check = async (fields: MinimalConfigField[]) => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        entities: {
          collections: [postsWith(fields)],
          singles: [],
          components: [],
        },
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });
      return logger;
    };

    it("fails a new pair, naming the entity, the container and both fields", async () => {
      await seedRecording([text("title"), seo(["fooBar"])]);

      const logger = await check([text("title"), seo(["fooBar", "foo_bar"])]);

      const message =
        "Collection 'posts': fields 'fooBar' and 'foo_bar' in group 'seo' would both become the column 'foo_bar'. Rename one of them.";
      expect(logger.error).toHaveBeenCalledWith(message);
      // It ends in the error shape, naming the pair again, as the address refusal ends.
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining(`fields: ${message}`)
      );
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(CONFIG_INVALID)")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.success).not.toHaveBeenCalled();
    });

    it("passes a pair the latest snapshot records, warning exactly once per pair", async () => {
      const fields = [
        text("fooBar"),
        text("foo_bar"),
        seo(["headline", "headline"]),
      ];
      await seedRecording(fields);

      const logger = await check(fields);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn.mock.calls.map(([line]) => line)).toEqual([
        "Collection 'posts': fields 'fooBar' and 'foo_bar' at the top level already share the column 'foo_bar'. They keep working; rename one of them so each keeps its own value.",
        "Collection 'posts': fields 'headline' and 'headline' in group 'seo' already share the key 'headline'. They keep working; rename one of them so each keeps its own value.",
      ]);
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("migrate:check OK")
      );
    });
  });
});
