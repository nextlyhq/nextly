/**
 * An old Schema Builder file is ignored by every reader, named only with an
 * informational line, and its ledger rows are marked while it can be read —
 * on every configured dialect.
 *
 * The file is the Builder's own: `DynamicCollectionService.generateCollection`
 * plans a create and `CollectionFileManager.saveMigration` writes it, the two
 * steps a Builder create takes on a project, so its name and contents are the
 * ones a real save leaves, with no snapshot beside it.
 *
 * The control is a hand-written file with no snapshot, which `nextly migrate`
 * still applies as written: what is ignored is a file with the whole
 * signature, not every file without a snapshot.
 */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { defineConfig } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { loadedDialect } from "../../../database/dialect-tables";
import { DynamicCollectionService } from "../../../domains/dynamic-collections/services/dynamic-collection-service";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { checksumOf } from "../../../domains/schema/migrate/applied-checksums";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CollectionFileManager } from "../../../services/collection-file-manager";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import {
  assertAppliedFilesPresent,
  runFileMigrations,
  runMigrate,
} from "../migrate";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateStatus } from "../migrate-status";

/** The config the commands load. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-builder-file-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  loaded.config = defineConfig({
    collections: [],
    db: { migrationsDir: "./migrations" },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** A booted instance the commands reach through `DATABASE_URL`. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  if (dialect !== "sqlite") return createTestNextly({ dialect });
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter });
}

const quiet = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Write the migration a Builder create of `slug` writes, as the Builder writes it. */
async function builderCreates(t: TestNextly, slug: string): Promise<string> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const artifacts = (await new DynamicCollectionService(
    adapter,
    quiet
  ).generateCollection({
    name: slug,
    fields: [{ name: "title", type: "text" }],
  } as never)) as unknown as {
    migrationSQL: string;
    migrationFileName: string;
  };
  await new CollectionFileManager(adapter.getDrizzle() as never, {
    schemasDir: join(dir, "schemas"),
    migrationsDir: join(dir, "migrations"),
  }).saveMigration(artifacts.migrationSQL, artifacts.migrationFileName);
  return artifacts.migrationFileName;
}

/** A command's context, with everything it says captured. */
function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  // The error a command ends with is printed on standard error, in the error shape.
  vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  return {
    context: {
      logger: {
        ...base,
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** Run `fn`, turning `process.exit` into the code it was called with. */
async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

type Rows = Record<string, unknown>[];
interface Selecting {
  select: () => { from: (table: unknown) => Promise<Rows> };
}

/** Everything the refusal must leave as it was: tables, ledger, registry. */
async function state(t: TestNextly, dialect: TestDialect) {
  const adapter = t.adapter as unknown as DrizzleAdapter & {
    listTables: () => Promise<string[]>;
  };
  const db = adapter.getDrizzle<Selecting>();
  const { tables } = loadedDialect(dialect);
  const byId = (rows: Rows) =>
    [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    tables: [...(await adapter.listTables())].sort(),
    ledger: byId(await db.select().from(tables.nextlySchemaEvents)),
    collections: byId(await db.select().from(tables.dynamicCollections)),
  };
}

const IGNORED = "ignored: written by an earlier Schema Builder";

/** The ledger as a test reads it. */
function ledger(t: TestNextly, dialect: TestDialect): SchemaEventsRepository {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  return new SchemaEventsRepository(adapter.getDrizzle(), dialect);
}

/** A row naming `file` applied, as an earlier version's `nextly migrate` wrote it. */
async function appliedEarlier(
  t: TestNextly,
  dialect: TestDialect,
  file: string
): Promise<void> {
  const content = readFileSync(join(dir, "migrations", file), "utf8");
  await ledger(t, dialect).insertEvent({
    eventType: "file_apply",
    status: "applied",
    source: "cli-migrate",
    filename: file,
    sha256: checksumOf(content),
    endedAt: new Date(),
  });
}

/** Every mark of `file`, oldest first. */
async function marksOf(
  t: TestNextly,
  dialect: TestDialect,
  file: string
): Promise<Rows> {
  const rows = (await state(t, dialect)).ledger.filter(
    row => row.eventType === "old_builder_file" && row.filename === file
  );
  return rows.sort(
    (a, b) =>
      new Date(a.startedAt as Date).getTime() -
      new Date(b.startedAt as Date).getTime()
  );
}

/** `nextly migrate`, with its exit code and what it said. */
async function migrate(): Promise<{
  code: number | undefined;
  said: string[];
}> {
  const { context, said } = command();
  const code = await exitCode(() => runMigrate({ cwd: dir }, context));
  return { code, said };
}

describe.each(getConfiguredTestDialects())(
  "an old Schema Builder file (%s)",
  dialect => {
    const q = dialect === "mysql" ? "`" : '"';

    beforeEach(async () => {
      instance = await boot(dialect);
    });

    it("nextly migrate ignores it, naming it with the line, and applies nothing from it", async () => {
      const t = instance!;
      const file = await builderCreates(t, "bf_events");

      const { code, said } = await migrate();

      expect(code, said.join("\n")).toBeUndefined();
      expect(said).toContain(`${file}: ${IGNORED}`);
      const after = await state(t, dialect);
      expect(after.tables).not.toContain("dc_bf_events");
      expect(after.ledger.filter(row => row.filename === file)).toEqual([]);
    });

    it("migrate:check names it and checks the rest", async () => {
      await builderCreates(instance!, "bf_events");
      const { context, said } = command();
      const code = await exitCode(() => runMigrateCheck({ cwd: dir }, context));
      expect(code, said.join("\n")).toBeUndefined();
      expect(said.filter(line => line.includes(IGNORED))).toHaveLength(1);
    });

    it("migrate:status --json lists it in its field alone, with the line on standard error", async () => {
      const file = await builderCreates(instance!, "bf_events");
      const stdout: string[] = [];
      const stderr: string[] = [];
      vi.spyOn(console, "log").mockImplementation(message => {
        stdout.push(String(message));
      });
      vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
        stderr.push(String(chunk));
        return true;
      });
      const { context } = command();
      await runMigrateStatus({ cwd: dir, json: true }, context);
      const document = JSON.parse(stdout.join("\n")) as {
        migrations: { name: string }[];
        ignoredOldBuilderFiles: string[];
      };
      expect(document.ignoredOldBuilderFiles).toEqual([file]);
      expect(document.migrations).toEqual([]);
      expect(stderr.join("")).toContain(`${file}: ${IGNORED}`);
    });

    it("drops nothing when the file is a bulk delete", async () => {
      const keep = "20261028_120000_000_keep.sql";
      writeFileSync(
        join(dir, "migrations", keep),
        `-- Migration: keep\n\n-- UP\nCREATE TABLE ${q}dc_keep${q} (${q}id${q} varchar(36) PRIMARY KEY);\n\n-- DOWN\nDROP TABLE ${q}dc_keep${q};\n`
      );
      expect((await migrate()).code).toBeUndefined();
      // Named as the Builder names a delete of `keep` and `other`: the count,
      // then the first 12 hex digits of the SHA-256 of "keep,other".
      writeFileSync(
        join(
          dir,
          "migrations",
          "1761732000000_drop_2_collections_b7078bfa1774.sql"
        ),
        `-- Drop dynamic collections: keep, other\nDROP TABLE IF EXISTS ${q}dc_keep${q};`
      );

      const { code, said } = await migrate();

      expect(code, said.join("\n")).toBeUndefined();
      expect((await state(instance!, dialect)).tables).toContain("dc_keep");
    });

    // A file with a Builder name that the classifier cannot recognise as an
    // earlier Builder's, and no snapshot, is refused as before this release:
    // its statements are old Builder SQL nothing checks. Here a custom
    // junction renamed by an update, a name nothing declares any more.
    it("refuses a Builder-named file it cannot recognise, naming it and the fix", async () => {
      const t = instance!;
      const file = "1761732000000_update_posts.sql";
      writeFileSync(
        join(dir, "migrations", file),
        `ALTER TABLE ${q}post_tag_links${q} RENAME TO ${q}post_tag_refs${q};\n`
      );
      const before = await state(t, dialect);

      const { code, said } = await migrate();

      expect(code, said.join("\n")).toBe(1);
      const refusal = said.join("\n");
      expect(refusal).toContain(file);
      expect(refusal).toMatch(/not its own entity's/);
      expect(refusal).toContain("nextly migrate:create");
      expect(refusal).toMatch(/or delete it/);
      expect(await state(t, dialect)).toEqual(before);
    });

    // A junction counts as an entity's own only when its own fields declare
    // it: a posts file dropping a junction the authors collection declares
    // is not recognised, so it is refused.
    it("refuses a file that drops another collection's declared junction", async () => {
      loaded.config = defineConfig({
        collections: [
          {
            slug: "authors",
            fields: [
              {
                name: "topics",
                type: "relationship",
                relationTo: "topics",
                hasMany: true,
                options: { junctionTable: "author_topic_links" },
              },
            ],
          },
        ] as never,
        db: { migrationsDir: "./migrations" },
      });
      const file = "1761732000001_update_posts.sql";
      writeFileSync(
        join(dir, "migrations", file),
        `DROP TABLE IF EXISTS ${q}author_topic_links${q};\n`
      );
      const { code, said } = await migrate();
      expect(code, said.join("\n")).toBe(1);
      expect(said.join("\n")).toContain(file);
    });

    // A Builder-named file can exist only as a dialect's variant, the file the
    // run selects and executes: it is refused as the base file would be.
    it("refuses an unrecognised Builder-named file that exists only as a dialect variant", async () => {
      const t = instance!;
      const file = `1761732000002_update_posts.${dialect}.sql`;
      writeFileSync(
        join(dir, "migrations", file),
        `ALTER TABLE ${q}post_tag_links${q} RENAME TO ${q}post_tag_refs${q};\n`
      );
      const before = await state(t, dialect);
      const { code, said } = await migrate();
      expect(code, said.join("\n")).toBe(1);
      expect(said.join("\n")).toMatch(/not recognised as an earlier Builder's/);
      expect(said.join("\n")).toContain(file);
      expect(await state(t, dialect)).toEqual(before);
    });

    // The files that run are judged again right before they run, whatever
    // the folder held when the run began.
    it("refuses an unrecognised file at the point the files phase runs", async () => {
      const t = instance!;
      writeFileSync(
        join(dir, "migrations", "1761732000003_update_posts.sql"),
        `ALTER TABLE ${q}post_tag_links${q} RENAME TO ${q}post_tag_refs${q};\n`
      );
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await expect(
        runFileMigrations({
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir: join(dir, "migrations"),
          logger: createLogger({ quiet: true }),
          refuseUnrecognisedBuilderFiles: true,
        })
      ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING" });
    });

    it("a hand-written file with no snapshot still applies as written", async () => {
      const t = instance!;
      const file = "20261028_120000_000_hand_written.sql";
      writeFileSync(
        join(dir, "migrations", file),
        `-- Migration: hand_written\n\n-- UP\nCREATE TABLE ${q}bf_hand${q} (${q}id${q} varchar(36) PRIMARY KEY);\n\n-- DOWN\nDROP TABLE ${q}bf_hand${q};\n`
      );
      expect(readdirSync(join(dir, "migrations"))).toEqual([file]);

      const { code, said } = await migrate();

      expect(code, said.join("\n")).toBeUndefined();
      expect(await ledger(t, dialect).isFileApplied(file)).toBe(true);
    });

    it("marks the row naming it once, and records a new checksum after an edit within the signature", async () => {
      const t = instance!;
      const file = await builderCreates(t, "bf_events");
      await appliedEarlier(t, dialect, file);

      expect((await migrate()).code).toBeUndefined();
      const first = await marksOf(t, dialect, file);
      expect(first.map(m => [m.status, m.sha256])).toEqual([
        [
          "applied",
          checksumOf(readFileSync(join(dir, "migrations", file), "utf8")),
        ],
      ]);
      expect((await migrate()).code).toBeUndefined();
      expect(await marksOf(t, dialect, file)).toHaveLength(1);

      // Still the whole signature: a statement on the entity's own table,
      // after a `;` ending the registry upsert the Builder's file ends with.
      appendFileSync(
        join(dir, "migrations", file),
        `;\nALTER TABLE ${q}dc_bf_events${q} ADD COLUMN ${q}extra${q} text;\n`
      );
      expect((await migrate()).code).toBeUndefined();
      const marks = await marksOf(t, dialect, file);
      expect(marks.map(m => m.sha256)).toEqual([
        first[0]?.sha256,
        checksumOf(readFileSync(join(dir, "migrations", file), "utf8")),
      ]);
    });

    it("refuses with code 2 once a marked file changes out of the signature, and proceeds once it is deleted", async () => {
      const t = instance!;
      const file = await builderCreates(t, "bf_events");
      await appliedEarlier(t, dialect, file);
      expect((await migrate()).code).toBeUndefined();

      appendFileSync(
        join(dir, "migrations", file),
        `;\nALTER TABLE ${q}dc_other${q} ADD COLUMN ${q}x${q} text;\n`
      );
      const before = await state(t, dialect);
      const refused = await migrate();
      expect(refused.code, refused.said.join("\n")).toBe(2);
      expect(refused.said.join("\n")).toMatch(
        new RegExp(
          `${file}.*recognised as a file an earlier Schema Builder wrote`
        )
      );
      expect(await state(t, dialect)).toEqual(before);

      rmSync(join(dir, "migrations", file));
      const after = await migrate();
      expect(after.code, after.said.join("\n")).toBeUndefined();
      expect(after.said.join("\n")).not.toContain(file);
    });

    it("refuses a marked file once a snapshot stands beside it, and ignores it again once it is removed", async () => {
      const t = instance!;
      const file = await builderCreates(t, "bf_events");
      await appliedEarlier(t, dialect, file);
      expect((await migrate()).code).toBeUndefined();

      const snapshot = join(
        dir,
        "migrations",
        "meta",
        file.replace(/\.sql$/, ".snapshot.json")
      );
      mkdirSync(join(dir, "migrations", "meta"), { recursive: true });
      writeFileSync(snapshot, "{}");
      const refused = await migrate();
      expect(refused.code, refused.said.join("\n")).toBe(1);
      expect(refused.said.join("\n")).toContain(
        "OLD_BUILDER_FILE_SNAPSHOT_ADDED"
      );

      rmSync(snapshot);
      const again = await migrate();
      expect(again.code, again.said.join("\n")).toBeUndefined();
      expect(again.said).toContain(`${file}: ${IGNORED}`);
    });

    it("counts an applied row as missing when its file is gone, unless a mark names it", async () => {
      const t = instance!;
      const file = await builderCreates(t, "bf_events");
      await appliedEarlier(t, dialect, file);
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const args = {
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect,
        migrationsDir: join(dir, "migrations"),
        logger: createLogger({ quiet: true }),
        command: "nextly migrate",
      };
      const path = join(dir, "migrations", file);
      const content = readFileSync(path, "utf8");
      rmSync(path);
      // Deleted before any run of this release recorded it: missing.
      await expect(assertAppliedFilesPresent(args)).rejects.toMatchObject({
        code: "MIGRATION_MISSING",
      });

      // Marked while it could be read, then deleted: never missing.
      writeFileSync(path, content);
      expect((await migrate()).code).toBeUndefined();
      expect(await marksOf(t, dialect, file)).toHaveLength(1);
      rmSync(path);
      await expect(assertAppliedFilesPresent(args)).resolves.toBeUndefined();
    });
  }
);
