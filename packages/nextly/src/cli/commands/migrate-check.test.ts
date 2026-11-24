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

import { planCompanionTypeChange } from "../../domains/i18n/migration/plan-companion-type-change";
import { prepareCompanionMigrationFile } from "../../domains/i18n/migration/write-migration-file";
import { blankLineHeader } from "../../domains/schema/migrate/history-line";
import { settingsOf } from "../../domains/schema/migrate-create/entity-settings";
import {
  formatBlankFile,
  formatMigrationFile,
} from "../../domains/schema/migrate-create/format-file";
import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigField,
} from "../../domains/schema/migrate-create/generate";
import { writeSnapshot } from "../../domains/schema/migrate-create/snapshot-io";
import { unwrittenOver } from "../../domains/schema/pending/__tests__/helpers/unwritten-over";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";

import type { UnwrittenChanges } from "../../domains/schema/migrate/unwritten-changes";
import { toCliError } from "../errors/from-thrown";
import { formatCliError } from "../errors/render";

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

/** `posts` as a configuration declares it. */
const POSTS_ENTITY = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "headline", type: "text" }],
};

/** The tables `entities` make, as `migrate:create` records them. */
const tablesOf = (
  entities: Parameters<typeof buildDesiredSnapshotFromConfig>[0]
): NextlySchemaSnapshot =>
  buildDesiredSnapshotFromConfig(entities, [], [], "postgresql");

const POSTS_DESIRED = tablesOf([POSTS_ENTITY]);

/**
 * The changes not yet in a migration as the comparison answers them (`unwrittenChangesOf`),
 * naming `tables` as added: what the check reports, the comparison itself being
 * `migrate:create`'s plan, tested on its own (`pending-changes.test.ts`).
 */
const driftOf =
  (tables: NextlySchemaSnapshot["tables"], noSnapshot = false) =>
  (): Promise<UnwrittenChanges> =>
    Promise.resolve({
      tables: tables.map(table => ({ type: "add_table" as const, table })),
      beside: [],
      settings: [],
      permissions: [],
      noSnapshot,
    });
const EMPTY_DESIRED: NextlySchemaSnapshot = { tables: [] };

/**
 * A comparison that names nothing, for the statement cases over a hand-written table no
 * configuration declares, which a real one would name as dropped.
 */
const NOTHING_PENDING = driftOf([]);

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
        migrationsDir, // Compared for real: `migrate:create`'s own plan against the folder's snapshot.
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [POSTS_ENTITY],
        }),
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
        unwritten: unwrittenOver({ migrationsDir }),
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

    // The dialect defaults to PostgreSQL; a test of another dialect's statements passes its own.
    // Compared for real, with nothing declared, unless a case's table is one no configuration makes.
    const run = async (
      dialect: "postgresql" | "mysql" | "sqlite" = "postgresql",
      unwritten = unwrittenOver({ migrationsDir, dialect })
    ) => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten,
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
      const logger = await run("sqlite", NOTHING_PENDING);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /DESTRUCTIVE: 20260101_120000_002_drop_body\.sql \(UP\) deletes data: column notes\.body\. nextly migrate runs it only with --accept-data-loss/
        )
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    // A dialect's variant leaves the schema its group's snapshot records
    // (`meta/<base>.snapshot.json`): the file after it is judged against that.
    it("names the column a SQLite rebuild leaves out after a migration written with a SQLite variant", async () => {
      await createNotes();
      await writeFile(
        join(migrationsDir, "20260101_120000_001_notes.sqlite.sql"),
        '-- UP\nCREATE TABLE "notes" ("id" integer PRIMARY KEY NOT NULL, "title" text, "body" text);\n\n-- DOWN\n',
        "utf-8"
      );
      await writeGenerated(
        "20260101_120000_002_drop_body",
        rebuildNotes(["id", "title"]),
        notesWith("id", "title")
      );
      const logger = await run("sqlite", NOTHING_PENDING);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /DESTRUCTIVE: 20260101_120000_002_drop_body\.sql \(UP\) deletes data: column notes\.body\./
        )
      );
    });

    it.each(["postgresql", "mysql", "sqlite"] as const)(
      "judges the file after a %s variant by its group's snapshot: a column it adds and drops again deletes nothing",
      async dialect => {
        await createNotes();
        await writeFile(
          join(migrationsDir, `20260101_120000_001_notes.${dialect}.sql`),
          "-- UP\nCREATE TABLE notes (id integer PRIMARY KEY NOT NULL, title text, body text);\n\n-- DOWN\n",
          "utf-8"
        );
        await writeGenerated(
          "20260101_120000_002_scratch",
          "-- UP\nALTER TABLE notes ADD COLUMN scratch text;\nALTER TABLE notes DROP COLUMN scratch;\n\n-- DOWN\n",
          notesWith("id", "title", "body")
        );
        const logger = await run(dialect, NOTHING_PENDING);
        expect(logger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining("DESTRUCTIVE")
        );
        expect(exitSpy).not.toHaveBeenCalled();
      }
    );

    it("reports nothing for a SQLite rebuild that carries every column", async () => {
      await createNotes();
      await writeGenerated(
        "20260101_120000_002_tighten",
        rebuildNotes(["id", "title", "body"]),
        notesWith("id", "title", "body")
      );
      const logger = await run("sqlite", NOTHING_PENDING);
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
        unwritten: unwrittenOver({ migrationsDir }),
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
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [POSTS_ENTITY],
        }),
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
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(MISSING_SNAPSHOT)")
      );
    });
  });

  // A translated field's translations column taking its new type is a companion file of its own,
  // written without a snapshot as every companion file is: it is passed by the marker the writer
  // gives it, not reported as a migration missing its snapshot.
  describe("a retypes companion file, which has no snapshot by design", () => {
    it("passes the file the writer prepares for a translations column's new type", async () => {
      const planned = planCompanionTypeChange({
        slug: "posts",
        kind: "collection",
        tableName: "dc_posts",
        dialect: "postgresql",
        defaultLocale: "en",
        fields: [
          {
            from: { name: "price", type: "text", localized: true },
            to: { name: "price", type: "number", localized: true },
          },
        ],
        builtBy: "collection",
      });
      if (planned === undefined) throw new Error("no retypes file planned");
      const prepared = await prepareCompanionMigrationFile(
        migrationsDir,
        planned.spec,
        {
          kind: "retypes",
          entity: "collection",
          upSql: planned.upSql,
          downSql: planned.downSql,
          now: new Date("2026-01-01T12:00:00Z"),
        }
      );
      await prepared.place();

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(printed).not.toHaveBeenCalledWith(
        expect.stringContaining("(MISSING_SNAPSHOT)")
      );
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });
  });

  describe("a blank migration, which has no snapshot by design", () => {
    it("passes a project whose blank migrations are of both styles", async () => {
      // As `migrate:create --blank` writes them: one stating no place, as it did earlier, and
      // one stating the migration it was written after.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_seed.sql"),
        formatBlankFile("seed", "postgresql", new Date("2026-01-01T12:00:00Z")),
        "utf-8"
      );
      await writeFile(
        join(migrationsDir, "20260102_120000_001_backfill.sql"),
        formatBlankFile(
          "backfill",
          "postgresql",
          new Date("2026-01-02T12:00:00Z"),
          {
            line: blankLineHeader({
              parent: "20260101_120000_001_seed",
              merges: [],
            }),
          }
        ),
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(printed).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });

    it("passes a blank migration whose author kept its place and removed the template's comments", async () => {
      await writeFile(
        join(migrationsDir, "20260101_120000_001_seed.sql"),
        "-- Migration: seed\n-- Parent: none\n\n-- UP\nSELECT 1;\n",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(printed).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });

    it("still refuses a file that only mentions a blank migration, and says how each kind of file is put right", async () => {
      // Neither mark: the words are in the file, but not as the template's line, and the
      // header states no place.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_add_posts.sql"),
        "-- Migration: add_posts\n--   -- This is a blank migration file for custom SQL.\n-- Parents: none\n\n-- UP\nCREATE TABLE posts (id text);\n",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      const message = String(printed.mock.calls[0]?.[0]);
      expect(message).toContain("(MISSING_SNAPSHOT)");
      expect(message).toContain("nextly migrate:create --blank");
      expect(message).toContain(
        "nextly migrate:resolve --applied '20260101_120000_001_add_posts' --skip-verify"
      );
    });

    it("holds a file that has a snapshot to it, whatever the file says of itself", async () => {
      const original = "CREATE TABLE foo (id text);";
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        POSTS_DESIRED,
        original
      );
      // Edited since, and given the blank template's line.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        `-- This is a blank migration file for custom SQL.\n${original} -- TAMPERED`,
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [POSTS_ENTITY],
        }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(CHECKSUM_MISMATCH)")
      );
    });

    // Each spelling `nextly migrate` opens the UP section with (`isUpMarker`), so the header ends
    // where the runner's statements begin.
    it.each(["-- UP", "-- UP: create", "-- UP create comments", "  -- UP  "])(
      "reads the marks in the file's header only, not in a comment among its statements (%j)",
      async upLine => {
        await writeFile(
          join(migrationsDir, "20260101_120000_001_add_comments.sql"),
          `-- Migration: add_comments\n\n${upLine}\n-- Parent: posts\n-- This is a blank migration file for custom SQL.\nCREATE TABLE comments (id text);\n`,
          "utf-8"
        );

        const logger = makeLogger();
        await runChecks({
          migrationsDir,
          unwritten: unwrittenOver({ migrationsDir }),
          logger: logger as unknown as Parameters<
            typeof runChecks
          >[0]["logger"],
        });

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(printed).toHaveBeenCalledWith(
          expect.stringContaining("(MISSING_SNAPSHOT)")
        );
      }
    );

    it("reads the template's line as the runner reads a line, with the spaces around it trimmed", async () => {
      await writeFile(
        join(migrationsDir, "20260101_120000_001_seed.sql"),
        "-- Migration: seed\n  -- This is a blank migration file for custom SQL. \t\r\n\n-- UP\nSELECT 1;\n",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(printed).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    });

    it("names a dialect's variant to migrate:resolve as that command finds it", async () => {
      await writeFile(
        join(migrationsDir, "20260101_120000_001_seed.mysql.sql"),
        "INSERT INTO foo (id) VALUES ('a');",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      const message = String(printed.mock.calls[0]?.[0]);
      expect(message).toContain("(MISSING_SNAPSHOT)");
      // The path looked at is the group's snapshot, the one a variant pairs with.
      expect(message).toContain(
        "Nothing is at `20260101_120000_001_seed.snapshot.json`"
      );
      expect(message).toContain(
        "nextly migrate:resolve --applied '20260101_120000_001_seed' --skip-verify"
      );
      expect(message).toContain("delete the file");
      // One dialect's SQL keeps its variant file: `migrate:create --blank` writes a file every
      // dialect runs.
      expect(message).toContain(
        "For SQL you wrote yourself for this dialect, add the line `-- This is a blank migration file for custom SQL.` to its header"
      );
      expect(message).not.toContain("migrate:create --blank");
    });

    it("quotes the name in the command it advises, so a name with a space or a quote stays one argument", async () => {
      await writeFile(
        join(migrationsDir, "20260101_120000_001_owner's seed.sql"),
        "INSERT INTO foo (id) VALUES ('a');",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      const message = String(printed.mock.calls[0]?.[0]);
      expect(message).toContain(
        "nextly migrate:resolve --applied '20260101_120000_001_owner'\\''s seed' --skip-verify"
      );
    });

    it("holds a generated migration beside a blank one to its snapshot", async () => {
      await writeFile(
        join(migrationsDir, "20260101_120000_001_seed.sql"),
        formatBlankFile("seed", "postgresql", new Date("2026-01-01T12:00:00Z")),
        "utf-8"
      );
      // A generated file whose snapshot is gone carries neither mark.
      await writeFile(
        join(migrationsDir, "20260102_120000_001_add_posts.sql"),
        formatMigrationFile({
          name: "add_posts",
          dialect: "postgresql",
          sqlStatements: ["CREATE TABLE posts (id text)"],
          downSqlStatements: ["DROP TABLE posts"],
          collections: ["posts"],
          singles: [],
          components: [],
          hasUserExt: false,
        }),
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining(
          "`20260102_120000_001_add_posts.sql` has no paired snapshot"
        )
      );
    });
  });

  // A dialect's variant (`<base>.mysql.sql`) runs in place of `<base>.sql` on that dialect and
  // is the same migration: its snapshot is its group's, `meta/<base>.snapshot.json`, as the
  // runner and every reader of `meta/` pair them. No `<base>.mysql.snapshot.json` is written.
  describe("a dialect's variant, paired with its group's snapshot", () => {
    it("passes a variant beside its group's snapshot, which holds the base file to its hash", async () => {
      const base = "20260101_120000_001_initial";
      await writeFile(join(migrationsDir, `${base}.sql`), "-- base", "utf-8");
      await writeFile(
        join(migrationsDir, `${base}.mysql.sql`),
        "-- written for MySQL",
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        base,
        POSTS_DESIRED,
        "-- base"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [POSTS_ENTITY],
        }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(printed).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    /** The checks over the folder as written, with no tables declared. */
    const check = async () => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });
    };

    // A migration says once that it is blank, in any of its files: a variant that says nothing
    // is a file of its migration, as the history reads it.
    it("passes a blank migration's variant that carries no mark of its own", async () => {
      const base = "20260101_120000_001_seed";
      await writeFile(
        join(migrationsDir, `${base}.sql`),
        formatBlankFile("seed", "postgresql", new Date("2026-01-01T12:00:00Z")),
        "utf-8"
      );
      await writeFile(
        join(migrationsDir, `${base}.mysql.sql`),
        "-- UP\nINSERT INTO foo (id) VALUES ('a');\n",
        "utf-8"
      );

      await check();

      expect(printed).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("passes a migration whose blank mark only its variant carries", async () => {
      const base = "20260101_120000_001_seed";
      await writeFile(
        join(migrationsDir, `${base}.sql`),
        "-- UP\nINSERT INTO foo (id) VALUES ('a');\n",
        "utf-8"
      );
      await writeFile(
        join(migrationsDir, `${base}.mysql.sql`),
        formatBlankFile("seed", "mysql", new Date("2026-01-01T12:00:00Z")),
        "utf-8"
      );

      await check();

      expect(printed).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    // Two files of one migration that state different places: the check fails as `nextly
    // migrate` refuses, naming both, rather than ending on an unexpected error.
    it("fails a migration whose base and variant state different places, naming both", async () => {
      const seed = "20260101_120000_001_seed";
      const tune = "20260102_120000_001_tune";
      await writeFile(
        join(migrationsDir, `${seed}.sql`),
        formatBlankFile("seed", "postgresql", new Date("2026-01-01T12:00:00Z")),
        "utf-8"
      );
      for (const [file, parent] of [
        [`${tune}.sql`, seed],
        [`${tune}.mysql.sql`, null],
      ] as const) {
        await writeFile(
          join(migrationsDir, file),
          formatBlankFile(
            "tune",
            "postgresql",
            new Date("2026-01-02T12:00:00Z"),
            {
              line: blankLineHeader({ parent, merges: [] }),
            }
          ),
          "utf-8"
        );
      }

      // Both pass their pairing (a blank migration); the line's reading refuses, as `nextly
      // migrate` refuses it, and the command's catch ends it in its own code.
      const refusal = toCliError(
        await check().then(
          () => undefined,
          (error: unknown) => error
        )
      );
      expect(printed).not.toHaveBeenCalled();
      expect(refusal.code).toBe("MIGRATION_PLACE_STATED_TWICE");
      expect(formatCliError(refusal)).toContain(
        `\`${tune}.sql\` states \`-- Parent: ${seed}\`, and \`${tune}.mysql.sql\` states \`-- Parent: none\`.`
      );
    });

    it("passes a migration written only as a variant, whose snapshot is its group's", async () => {
      const base = "20260101_120000_001_initial";
      await writeFile(
        join(migrationsDir, `${base}.sqlite.sql`),
        "-- written for SQLite",
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        base,
        POSTS_DESIRED,
        "-- base"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [POSTS_ENTITY],
        }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(printed).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
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
        unwritten: unwrittenOver({ migrationsDir }),
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
        unwritten: unwrittenOver({ migrationsDir }),
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
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [POSTS_ENTITY],
        }),
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
      // Empty migrations + meta, and a comparison naming the posts table added.
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [POSTS_ENTITY],
        }),
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
      // Seed a snapshot with EMPTY tables; the comparison names posts added.
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
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [POSTS_ENTITY],
        }),
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

    it("names every change, as `nextly migrate` names them", async () => {
      // Seed an empty snapshot; the comparison names 15 tables added.
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

      const collections = Array.from({ length: 15 }, (_, i) => {
        const slug = `t${i.toString().padStart(2, "0")}`;
        return { slug, tableName: `dc_${slug}`, fields: [] };
      });

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({ migrationsDir, collections }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("15 pending schema change(s) detected.")
      );
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("add_table dc_t14")
      );
      // The check reads no database, so it says nothing of one, nor of running `nextly migrate`.
      const said = printed.mock.calls.flat().join("\n");
      expect(said).not.toContain("The database is not reported");
      expect(said).not.toContain("run `nextly migrate` again");
    });

    it("names settings alone as settings, in its own words", async () => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: () =>
          Promise.resolve({
            tables: [],
            beside: [],
            settings: [
              { kind: "collection", slug: "posts", changes: ["description"] },
            ],
            permissions: [],
            noSnapshot: false,
          }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      const said = printed.mock.calls.flat().join("\n");
      expect(said).toContain("(SETTINGS_CHANGE_WITHOUT_MIGRATION)");
      expect(said).toContain("1 entity's settings changed with no migration.");
      expect(said).toContain("~ posts: description");
      expect(said).not.toContain("The database is not reported");
    });

    it("lists a file beside the main migration with the settings it comes from, labelled", async () => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: () =>
          Promise.resolve({
            tables: [],
            beside: [{ kind: "translations column types", table: "dc_posts" }],
            settings: [
              {
                kind: "collection",
                slug: "posts",
                changes: ["fields.price.type"],
              },
            ],
            permissions: [],
            noSnapshot: false,
          }),
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      const said = printed.mock.calls.flat().join("\n");
      expect(said).toContain("(SCHEMA_DRIFT)");
      expect(said).toContain("2 pending schema change(s) detected.");
      expect(said).toContain("~ translations column types dc_posts");
      expect(said).toContain("~ settings posts: fields.price.type");
    });

    it("asks a migration for the other change where several fields move from one table", async () => {
      const move = {
        table: "dc_posts",
        localesTable: "dc_posts_locales",
        columns: ["title", "summary"],
        fields: [
          { name: "title", type: "text" },
          { name: "summary", type: "text" },
        ],
      };
      const over = async (tables: UnwrittenChanges["tables"]) => {
        printed.mockClear();
        const logger = makeLogger();
        await runChecks({
          migrationsDir,
          unwritten: () =>
            Promise.resolve({
              tables,
              beside: [{ kind: "translations table", table: "dc_posts" }],
              settings: [],
              permissions: [],
              noSnapshot: false,
              perLanguageMoves: [move],
            }),
          logger: logger as unknown as Parameters<
            typeof runChecks
          >[0]["logger"],
        });
        return printed.mock.calls.flat().join("\n");
      };

      expect(
        await over([
          {
            type: "add_column",
            tableName: "dc_posts",
            column: { name: "views", type: "int4", nullable: true },
          },
        ])
      ).toContain("For the other changes listed");
      expect(await over([])).not.toContain("For the other changes listed");
    });
  });

  describe("addresses, by the one address rule", () => {
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
      await seed(tablesOf([entity("admin", "dc_admin")]));

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [entity("admin", "dc_admin")],
        }),
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
      await seed(tablesOf([entity("posts", "dc_posts")]));

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [
            entity("posts", "dc_posts"),
            entity("cascade", "dc_cascade"),
          ],
        }),
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
      settings: {
        source: "code" as const,
        settings: settingsOf({ slug: "posts", fields }, "code"),
      },
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
        tablesOf([postsWith(fields)]),
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
        unwritten: unwrittenOver({
          migrationsDir,
          collections: [postsWith(fields)],
        }),
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

    // Two fields reading and writing one column or key are refused, however long the snapshot has
    // recorded them, naming the value they share.
    it("fails a pair the latest snapshot records that shares a column or a key", async () => {
      const fields = [
        text("fooBar"),
        text("foo_bar"),
        seo(["headline", "headline"]),
      ];
      await seedRecording(fields);

      const logger = await check(fields);

      expect(logger.error.mock.calls.map(([line]) => line)).toEqual([
        "Collection 'posts': fields 'fooBar' and 'foo_bar' at the top level share the column 'foo_bar'. Rename one of them so each has its own column.",
        "Collection 'posts': fields 'headline' and 'headline' in group 'seo' share the key 'headline'. Rename one of them so each has its own key.",
      ]);
      expect(printed).toHaveBeenCalledWith(
        expect.stringContaining("(CONFIG_INVALID)")
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.success).not.toHaveBeenCalled();
    });

    // Two names that differ only in case inside a group are two keys of its value: recorded, they
    // keep working, and the check warns once.
    it("passes a recorded pair sharing no stored value, warning exactly once", async () => {
      const fields = [text("title"), seo(["Ab", "aB"])];
      await seedRecording(fields);

      const logger = await check(fields);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn.mock.calls.map(([line]) => line)).toEqual([
        "Collection 'posts': fields 'Ab' and 'aB' in group 'seo' differ only in letter case. They keep working; rename one of them.",
      ]);
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("migrate:check OK")
      );
    });
  });
});
