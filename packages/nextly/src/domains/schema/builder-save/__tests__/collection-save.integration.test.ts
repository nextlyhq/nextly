/**
 * A Schema Builder save of a collection writes its definition, then the migration and snapshot
 * `migrate:create` would write for it, into the configured migrations folder, and in development
 * runs the file through the runner `nextly migrate` records with, on every dialect.
 *
 * What each case reads is the outcome a person and a deploy see: the files in the folder, the
 * definition file, the table, and the ledger. After a save `nextly migrate` has nothing to run,
 * because the file is recorded applied with its checksum. A save the migration history refuses
 * changes nothing. A save whose statements fail where nothing applied leaves no file and puts the
 * definition back. A collection whose table no snapshot records is adopted first, so the folder
 * replays it.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineConfig } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { UiSchemaEntity } from "../../../../schemas/_zod/ui-schema";
import { _resetEnvCache } from "../../../../shared/lib/env";
import {
  migrateCore,
  runFileMigrations,
} from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { DynamicCollectionService } from "../../../dynamic-collections/services/dynamic-collection-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { checksumOf } from "../../migrate/applied-checksums";
import { NO_CONSENT } from "../../migrate/data-loss-consent";
import { splitSqlStatements } from "../../migrate/split-sql";
import { junctionTableNameFor } from "../../services/field-column-descriptor";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  previewCollectionSave,
  writeCollectionSave,
  type CollectionSaveDeps,
} from "../collection-save";

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-builder-save-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

async function boot(
  dialect: TestDialect,
  file = "test.db"
): Promise<TestNextly> {
  if (dialect !== "sqlite") return createTestNextly({ dialect });
  const url = `file:${join(dir, file)}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter });
}

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

/** A collection as the Builder's definition records it. */
function posts(
  fields: UiSchemaEntity["fields"],
  label = "Post"
): UiSchemaEntity {
  return {
    slug: "posts",
    labels: { singular: label, plural: `${label}s` },
    fields,
  } as UiSchemaEntity;
}

const text = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, type: "text", ...extra }) as UiSchemaEntity["fields"][number];

describe.each(getConfiguredTestDialects())(
  "a Schema Builder save of a collection (%s)",
  dialect => {
    let t: TestNextly;
    let adapter: DrizzleAdapter;

    beforeEach(async () => {
      t = await boot(dialect);
      instance = t;
      adapter = t.adapter as unknown as DrizzleAdapter;
    });

    function deps(over: Partial<CollectionSaveDeps> = {}): CollectionSaveDeps {
      return {
        adapter,
        config: defineConfig({
          collections: [],
          db: { migrationsDir: "./migrations" },
        }),
        projectRoot: dir,
        migrationsDir: join(dir, "migrations"),
        applies: true,
        logger: quiet,
        ...over,
      };
    }

    const migrationFiles = () =>
      readdirSync(join(dir, "migrations"))
        .filter(f => f.endsWith(".sql"))
        .sort();
    const snapshotFiles = () =>
      existsSync(join(dir, "migrations", "meta"))
        ? readdirSync(join(dir, "migrations", "meta")).sort()
        : [];
    const definition = () =>
      existsSync(join(dir, "ui-schema.json"))
        ? readFileSync(join(dir, "ui-schema.json"), "utf-8")
        : undefined;
    const definedSlugs = () =>
      (
        JSON.parse(definition() ?? '{"collections":[]}') as {
          collections: { slug: string; fields: { name: string }[] }[];
        }
      ).collections;
    async function columns(): Promise<string[] | undefined> {
      const live = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        dialect === "postgresql" ? "postgresql" : dialect,
        ["dc_posts"]
      );
      return live.tables
        .find(table => table.name === "dc_posts")
        ?.columns.map(c => c.name)
        .sort();
    }
    async function appliedRows() {
      const repo = new SchemaEventsRepository(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect
      );
      return (await repo.listFileApplies())
        .filter(row => row.status === "applied")
        .map(row => ({ filename: row.filename, sha256: row.sha256 }))
        .sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
    }
    const checksumOfFile = (file: string) =>
      checksumOf(readFileSync(join(dir, "migrations", file), "utf-8"));

    it("writes the create's file and snapshot first, runs it, and records it applied", async () => {
      const result = await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("title")]),
        change: "create",
      });

      const files = migrationFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{8}_\d{6}_\d{3}_posts_create\.sql$/);
      expect(snapshotFiles()).toEqual([
        files[0]!.replace(/\.sql$/, ".snapshot.json"),
      ]);
      expect(result.files).toEqual(files);
      expect(result.applied).toBe(true);
      expect(await columns()).toContain("title");
      expect(await appliedRows()).toEqual([
        { filename: files[0], sha256: checksumOfFile(files[0]!) },
      ]);
      expect(definedSlugs().map(c => c.slug)).toEqual(["posts"]);
      expect(existsSync(join(dir, "src", "db", "migrations", "dynamic"))).toBe(
        false
      );
    });

    it("writes each later change as its own applied file, and renames what the person renamed", async () => {
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("body")]),
        change: "create",
      });
      await adapter.executeQuery(
        `INSERT INTO dc_posts (id, title, body, slug, created_at, updated_at) VALUES ('p1', 'A post', 'Kept', 'kept', '2026-11-06 00:00:00', '2026-11-06 00:00:00')`
      );

      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: posts([text("body")]),
        entity: posts([text("content"), text("subtitle")]),
        change: "update",
        renamedFields: [{ from: "body", to: "content" }],
      });

      const files = migrationFiles();
      expect(files).toHaveLength(2);
      expect(files[1]).toMatch(/_posts_update\.sql$/);
      const up = readFileSync(join(dir, "migrations", files[1]!), "utf-8");
      expect(up, up).toMatch(/RENAME COLUMN/);
      expect(await columns()).toEqual(
        expect.arrayContaining(["content", "subtitle"])
      );
      expect(await columns()).not.toContain("body");
      const rows = (await adapter.executeQuery(
        "SELECT content FROM dc_posts"
      )) as unknown as { content: string }[];
      expect(JSON.stringify(rows)).toContain("Kept");
      expect((await appliedRows()).map(r => r.filename)).toEqual(files);
      expect(definedSlugs()[0]?.fields.map(f => f.name)).toEqual([
        "content",
        "subtitle",
      ]);
    });

    it("drops the deleted collection's table and its definition", async () => {
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("title")]),
        change: "create",
      });

      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: posts([text("title")]),
        entity: null,
        change: "delete",
      });

      const files = migrationFiles();
      expect(files).toHaveLength(2);
      expect(files[1]).toMatch(/_posts_delete\.sql$/);
      expect(await columns()).toBeUndefined();
      expect(definedSlugs()).toEqual([]);
      expect((await appliedRows()).map(r => r.filename)).toEqual(files);
    });

    it("refuses a save while an applied file was edited, and changes nothing", async () => {
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("title")]),
        change: "create",
      });
      const [first] = migrationFiles();
      writeFileSync(
        join(dir, "migrations", first!),
        `${readFileSync(join(dir, "migrations", first!), "utf-8")}\n-- edited\n`
      );
      const before = {
        files: migrationFiles(),
        snapshots: snapshotFiles(),
        definition: definition(),
        columns: await columns(),
      };

      await expect(
        writeCollectionSave(deps(), {
          slug: "posts",
          previous: posts([text("title")]),
          entity: posts([text("title"), text("subtitle")]),
          change: "update",
        })
      ).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
        statusCode: 409,
        publicMessage: expect.stringContaining(first!),
      });

      expect({
        files: migrationFiles(),
        snapshots: snapshotFiles(),
        definition: definition(),
        columns: await columns(),
      }).toEqual(before);
    });

    it("outside development writes the definition, file and snapshot, and runs nothing", async () => {
      const result = await writeCollectionSave(deps({ applies: false }), {
        slug: "posts",
        previous: null,
        entity: posts([text("title")]),
        change: "create",
      });

      expect(migrationFiles()).toHaveLength(1);
      expect(snapshotFiles()).toHaveLength(1);
      expect(result.applied).toBe(false);
      expect(await columns()).toBeUndefined();
      expect(await appliedRows()).toEqual([]);
      expect(definedSlugs().map(c => c.slug)).toEqual(["posts"]);
    });

    // Windows ignores the mode and root writes past it, so neither can make the folder unwritable.
    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "leaves no file of a generation that failed part-way, and puts the definition back",
      async () => {
        await writeCollectionSave(deps(), {
          slug: "posts",
          previous: null,
          entity: posts([text("title")]),
          change: "create",
        });
        const before = {
          files: migrationFiles(),
          snapshots: snapshotFiles(),
          definition: definition(),
        };

        // The change's SQL file is written, then its snapshot cannot be.
        chmodSync(join(dir, "migrations", "meta"), 0o555);
        try {
          await expect(
            writeCollectionSave(deps(), {
              slug: "posts",
              previous: posts([text("title")]),
              entity: posts([text("title"), text("subtitle")]),
              change: "update",
            })
          ).rejects.toBeDefined();
        } finally {
          chmodSync(join(dir, "migrations", "meta"), 0o755);
        }

        expect({
          files: migrationFiles(),
          snapshots: snapshotFiles(),
          definition: definition(),
        }).toEqual(before);
      }
    );

    it("leaves no file and puts the definition back when the statements fail with nothing applied", async () => {
      // Declared 255 characters wide, so making `code` unique is the index alone on every dialect
      // (on MySQL a unique field that states no width is also bounded, a change of its own).
      const code = (extra: Record<string, unknown> = {}) =>
        text("code", {
          options: { variant: "short" },
          validation: { maxLength: 255 },
          ...extra,
        });
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("title"), code()]),
        change: "create",
      });
      for (const id of ["a", "b"]) {
        await adapter.executeQuery(
          `INSERT INTO dc_posts (id, title, code, slug, created_at, updated_at) VALUES ('${id}', 'T', 'same', '${id}', '2026-11-06 00:00:00', '2026-11-06 00:00:00')`
        );
      }
      const before = {
        files: migrationFiles(),
        snapshots: snapshotFiles(),
        definition: definition(),
        columns: await columns(),
        applied: await appliedRows(),
      };

      // Two rows share a code, so making it unique fails on its first statement.
      await expect(
        writeCollectionSave(deps(), {
          slug: "posts",
          previous: posts([text("title"), code()]),
          entity: posts([text("title"), code({ unique: true })]),
          change: "update",
        })
      ).rejects.toBeDefined();

      expect({
        files: migrationFiles(),
        snapshots: snapshotFiles(),
        definition: definition(),
        columns: await columns(),
        applied: await appliedRows(),
      }).toEqual(before);

      // Nothing of it is left to settle: the next save goes through.
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: posts([text("title"), code()]),
        entity: posts([text("title"), code(), text("subtitle")]),
        change: "update",
      });
      expect(await columns()).toContain("subtitle");
    });

    it("writes a relationship key an update adds into its file, and the table holds it", async () => {
      // The relationship as the admin writes it, added to a table that already exists: its key
      // reaches the file on every dialect, SQLite's as a rebuild of the table carrying the key.
      const authorKey = {
        name: "fk_dc_posts_author",
        columns: ["author"],
        referencesTable: "dc_authors",
        referencesColumns: ["id"],
        onDelete: "set null" as const,
        onUpdate: "no action" as const,
      };
      await writeCollectionSave(deps(), {
        slug: "authors",
        previous: null,
        entity: {
          slug: "authors",
          labels: { singular: "Author", plural: "Authors" },
          fields: [text("name")],
        } as UiSchemaEntity,
        change: "create",
      });
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("title")]),
        change: "create",
      });
      const author = {
        name: "author",
        type: "relationship",
        relationTo: "authors",
      } as UiSchemaEntity["fields"][number];

      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: posts([text("title")]),
        entity: posts([text("title"), author]),
        change: "update",
        keys: { before: [], after: [authorKey] },
      });

      const files = migrationFiles();
      const up = readFileSync(
        join(dir, "migrations", files[files.length - 1]!),
        "utf-8"
      );
      expect(up, up).toMatch(/REFERENCES\s+[`"]?dc_authors/);
      const live = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        dialect === "postgresql" ? "postgresql" : dialect,
        ["dc_posts"]
      );
      expect(
        live.tables[0]?.foreignKeys?.map(fk => ({
          columns: fk.columns,
          referencesTable: fk.referencesTable,
        }))
      ).toEqual([{ columns: ["author"], referencesTable: "dc_authors" }]);

      // A later save that rebuilds the table for another change (SQLite makes a column required by
      // rebuilding it) keeps the key: the file's rebuild carries it.
      const later = await writeCollectionSave(deps(), {
        slug: "posts",
        previous: posts([text("title"), author]),
        entity: posts([text("title", { required: true }), author]),
        change: "update",
        keys: { before: [authorKey], after: [authorKey] },
      });
      expect(later.applied).toBe(true);
      const kept = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        dialect === "postgresql" ? "postgresql" : dialect,
        ["dc_posts"]
      );
      expect(
        kept.tables[0]?.foreignKeys?.map(fk => fk.referencesTable)
      ).toEqual(["dc_authors"]);
    });

    it("writes a many-to-many field's join table into the file: made here, replayed on an empty database, dropped with the collection", async () => {
      const m2m = {
        name: "tags",
        type: "relationship",
        options: { target: "tags", relationType: "manyToMany" },
      };
      const junction = junctionTableNameFor("dc_posts", m2m);
      await writeCollectionSave(deps(), {
        slug: "tags",
        previous: null,
        entity: {
          slug: "tags",
          labels: { singular: "Tag", plural: "Tags" },
          fields: [text("label")],
        } as UiSchemaEntity,
        change: "create",
      });

      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("body"), m2m as UiSchemaEntity["fields"][number]]),
        change: "create",
        junctions: new DynamicCollectionService(
          adapter,
          quiet as never
        ).junctionStatements("dc_posts", [], [m2m as never]),
      });

      const files = migrationFiles();
      expect(files).toHaveLength(2);
      expect(
        readFileSync(join(dir, "migrations", files[1]!), "utf-8")
      ).toContain(junction);
      expect(await adapter.tableExists(junction)).toBe(true);
      expect((await appliedRows()).map(r => r.filename)).toEqual(files);

      // A deploy's database, empty, replays the folder and gets the same tables.
      await instance?.destroy();
      instance = await boot(dialect, "replay.db");
      const fresh = instance.adapter as unknown as DrizzleAdapter;
      await runFileMigrations({
        adapter: fresh as never,
        db: fresh.getDrizzle(),
        dialect: fresh.getCapabilities().dialect,
        migrationsDir: join(dir, "migrations"),
        logger: createLogger({ quiet: true }),
      });
      expect(await fresh.tableExists("dc_posts")).toBe(true);
      expect(await fresh.tableExists(junction)).toBe(true);

      await writeCollectionSave(deps({ adapter: fresh }), {
        slug: "posts",
        previous: posts([
          text("body"),
          m2m as UiSchemaEntity["fields"][number],
        ]),
        entity: null,
        change: "delete",
        junctions: new DynamicCollectionService(
          fresh,
          quiet as never
        ).junctionStatements("dc_posts", [m2m as never], []),
      });
      expect(await fresh.tableExists("dc_posts")).toBe(false);
      expect(await fresh.tableExists(junction)).toBe(false);
    });

    /** Insert a post with `body`, or none where it is null. */
    async function post(id: string, body: string | null): Promise<void> {
      await adapter.executeQuery(
        body === null
          ? `INSERT INTO dc_posts (id, title, slug, created_at, updated_at) VALUES ('${id}', 'T', '${id}', '2026-11-06 00:00:00', '2026-11-06 00:00:00')`
          : `INSERT INTO dc_posts (id, title, body, slug, created_at, updated_at) VALUES ('${id}', 'T', '${body}', '${id}', '2026-11-06 00:00:00', '2026-11-06 00:00:00')`
      );
    }
    async function nullable(column: string): Promise<boolean | undefined> {
      const live = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect,
        ["dc_posts"]
      );
      return live.tables[0]?.columns.find(c => c.name === column)?.nullable;
    }
    /** A new, empty database for the folder to replay on. */
    async function freshDatabase(): Promise<void> {
      await instance?.destroy();
      instance = await boot(dialect, "replay.db");
      adapter = instance.adapter as unknown as DrizzleAdapter;
    }
    /** `nextly migrate` over the folder, with or without consent, `step` files at most. */
    function replayed(acceptDataLoss: boolean, step?: number) {
      return migrateCore({
        ...(step === undefined ? {} : { step }),
        extensionSchema: undefined,
        dialect: adapter.getCapabilities().dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir: join(dir, "migrations"),
        logger: createLogger({ quiet: true }),
        lockMode: "fail-fast",
        consent: acceptDataLoss
          ? {
              given: { from: "flag", targets: "all" },
              earlier: [],
              ignored: [],
            }
          : NO_CONSENT,
        interactive: false,
      } as never);
    }

    it("fills a new required field's rows with the value the person gave, then makes it required, here and on replay", async () => {
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("body")]),
        change: "create",
      });
      await post("a", "x");
      await post("b", "y");
      const save = {
        slug: "posts",
        previous: posts([text("body")]),
        entity: posts([text("body"), text("subtitle", { required: true })]),
        change: "update",
        resolutions: [
          { column: "subtitle", kind: "fill" as const, value: "Untitled" },
        ],
      };

      expect((await previewCollectionSave(deps(), save)).notices).toEqual([
        "This save fills 2 rows with 'Untitled' in subtitle.",
      ]);
      await writeCollectionSave(deps(), save);

      const rows = (await adapter.executeQuery(
        "SELECT subtitle FROM dc_posts ORDER BY id"
      )) as unknown as { subtitle: string }[];
      expect(rows.map(r => r.subtitle)).toEqual(["Untitled", "Untitled"]);
      expect(await nullable("subtitle")).toBe(false);

      // On MySQL the NOT NULL is a prepared statement restating the column,
      // which `nextly migrate` cannot read and so asks consent for, as it does
      // for every MySQL file that makes a column required.
      await freshDatabase();
      await replayed(dialect === "mysql");
      expect(await nullable("subtitle")).toBe(false);
    });

    it("deletes the rows that do not fit a field made required, here, and asks consent on replay", async () => {
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("body")]),
        change: "create",
      });
      await post("a", "kept");
      await post("b", null);
      const save = {
        slug: "posts",
        previous: posts([text("body")]),
        entity: posts([text("body", { required: true })]),
        change: "update",
        resolutions: [
          { column: "body", kind: "delete_nonconforming" as const },
        ],
      };

      expect((await previewCollectionSave(deps(), save)).notices).toEqual([
        "This save also deletes 1 row here, and the rows that don't fit on every database the migration reaches.",
      ]);
      await writeCollectionSave(deps(), save);

      const rows = (await adapter.executeQuery(
        "SELECT id FROM dc_posts"
      )) as unknown as { id: string }[];
      expect(rows.map(r => r.id)).toEqual(["a"]);
      expect(await nullable("body")).toBe(false);

      // A deploy whose rows do not fit either: its `nextly migrate` runs the
      // file's DELETE only with consent, and names the file it refuses.
      await freshDatabase();
      await replayed(false, 1);
      await post("c", null);
      const update = migrationFiles().find(f =>
        f.endsWith("_posts_update.sql")
      );
      await expect(replayed(false)).rejects.toMatchObject({
        publicMessage: expect.stringContaining(update!.replace(/\.sql$/, "")),
      });
      await replayed(true);
      expect(await nullable("body")).toBe(false);
      expect(
        (await adapter.executeQuery("SELECT id FROM dc_posts")) as unknown[]
      ).toEqual([]);
    });

    /** A table an earlier version's Builder made, as it made it: in the database, in no snapshot. */
    async function earlierBuilderTable(): Promise<void> {
      const artifacts = (await new DynamicCollectionService(
        adapter,
        quiet as never
      ).generateCollection({
        name: "posts",
        label: "Post",
        fields: [{ name: "body", type: "text" }],
      } as never)) as unknown as {
        migrationSQL: string;
        localMigrationSQL?: string;
      };
      for (const statement of splitSqlStatements(
        artifacts.localMigrationSQL ?? artifacts.migrationSQL,
        adapter.getCapabilities().dialect
      )) {
        await adapter.executeQuery(statement);
      }
    }

    /** The save adding `subtitle` to the earlier Builder's posts. */
    // The definition declares `body` short, a width the earlier table never
    // had: a column the save genuinely has to convert.
    const shortBody = text("body", { options: { variant: "short" } });
    const addSubtitle = (acknowledged?: string[]) => ({
      slug: "posts",
      previous: posts([shortBody]),
      entity: posts([shortBody, text("subtitle")]),
      change: "update",
      ...(acknowledged === undefined
        ? {}
        : { acknowledgedConversions: acknowledged }),
    });

    // An earlier Builder made `body` unbounded; declared short it is
    // varchar(255) on PostgreSQL and MySQL. SQLite's text has no width.
    const converts = dialect !== "sqlite";
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    it("previews the save, naming each column it brings to the one mapping, and writes nothing", async () => {
      await earlierBuilderTable();
      const before = {
        files: migrationFiles(),
        definition: definition(),
        applied: await appliedRows(),
      };

      const preview = await previewCollectionSave(deps(), addSubtitle());

      expect(preview.adopts).toBe(true);
      expect(preview.conversions).toEqual(
        converts
          ? [
              {
                table: "dc_posts",
                column: "body",
                from: "text",
                to: "varchar(255)",
              },
            ]
          : []
      );
      expect(preview.notices).toEqual(
        converts
          ? [
              "This save also converts body from text to varchar(255), from an earlier Nextly version.",
            ]
          : []
      );
      expect({
        files: migrationFiles(),
        definition: definition(),
        applied: await appliedRows(),
      }).toEqual(before);
    });

    it("adopts the table as it stands, converts it to the one mapping, then writes the change", async () => {
      await earlierBuilderTable();

      const result = await writeCollectionSave(deps(), addSubtitle(["body"]));

      const files = migrationFiles();
      // The conversion runs alone before the change, so a value it cannot take stops it at its
      // first statement, with nothing applied.
      expect(files.map(f => f.replace(/^\d{8}_\d{6}_\d{3}_/, ""))).toEqual(
        converts
          ? ["posts_adopt.sql", "posts_convert.sql", "posts_update.sql"]
          : ["posts_adopt.sql", "posts_update.sql"]
      );
      expect(result.files).toEqual(files);
      const read = (f: string) =>
        readFileSync(join(dir, "migrations", f), "utf-8");
      expect(read(files[0]!)).toMatch(/CREATE TABLE/);
      if (converts) {
        // As the database has it, then brought to the mapping, then changed.
        expect(read(files[0]!)).toMatch(new RegExp(`${q("body")} text`, "i"));
        expect(read(files[1]!)).toMatch(
          new RegExp(`${q("body")}[^;]*varchar\\(255\\)`, "i")
        );
        expect(read(files[1]!)).not.toMatch(/subtitle/);
        expect(read(files[2]!)).not.toMatch(/varchar\(255\)/i);
      }
      expect(await columns()).toContain("subtitle");
      expect((await appliedRows()).map(r => r.filename)).toEqual(files);
    });

    it.runIf(converts)(
      "refuses a conversion the save was not shown to, and writes nothing",
      async () => {
        await earlierBuilderTable();
        const before = {
          files: migrationFiles(),
          definition: definition(),
          columns: await columns(),
          applied: await appliedRows(),
        };

        await expect(
          writeCollectionSave(deps(), addSubtitle())
        ).rejects.toMatchObject({
          code: "NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED",
          statusCode: 409,
          publicMessage: expect.stringContaining(
            "converts body from text to varchar(255)"
          ),
        });

        expect({
          files: migrationFiles(),
          definition: definition(),
          columns: await columns(),
          applied: await appliedRows(),
        }).toEqual(before);
      }
    );

    it.runIf(converts)(
      "refuses the save with MySQL's reason where a stored value is too long, and leaves no file",
      async () => {
        await earlierBuilderTable();
        await adapter.executeQuery(
          `INSERT INTO dc_posts (id, title, body, slug, created_at, updated_at) VALUES ('p1', 'A post', '${"x".repeat(300)}', 'long', '2026-11-06 00:00:00', '2026-11-06 00:00:00')`
        );
        const before = {
          files: migrationFiles(),
          definition: definition(),
          columns: await columns(),
          applied: await appliedRows(),
        };

        await expect(
          writeCollectionSave(deps(), addSubtitle(["body"]))
        ).rejects.toMatchObject({
          publicMessage: expect.stringMatching(/too long|Data truncated/i),
        });

        expect({
          files: migrationFiles(),
          definition: definition(),
          columns: await columns(),
          applied: await appliedRows(),
        }).toEqual(before);
        // Nothing is left to settle: the next save, with the value shortened, goes through.
        await adapter.executeQuery(`UPDATE dc_posts SET body = 'short'`);
        await writeCollectionSave(deps(), addSubtitle(["body"]));
        expect(await columns()).toContain("subtitle");
      }
    );

    /** The writer's dependencies with a config that names its languages, as a translated save needs. */
    const translatedDeps = () =>
      deps({
        config: defineConfig({
          collections: [],
          db: { migrationsDir: "./migrations" },
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        }),
      });
    const translated = (fields: UiSchemaEntity["fields"]): UiSchemaEntity =>
      ({ ...posts(fields), localized: true }) as UiSchemaEntity;
    /** Turning translation on for `title`, which writes the main file and then its translations-table file. */
    const enableTitle = {
      slug: "posts",
      previous: posts([text("title")]),
      entity: translated([text("title", { localized: true })]),
      change: "update" as const,
    };

    it("refuses to record a translation change whose push left the table short of its file, and records nothing", async () => {
      await writeCollectionSave(translatedDeps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("title")]),
        change: "create",
      });
      const applied = await appliedRows();

      // A push that applies nothing: the main table keeps `title`, which the file's snapshot moved.
      await expect(
        writeCollectionSave(translatedDeps(), enableTitle, {
          appliedBy: () => Promise.resolve(),
        })
      ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });

      expect(await appliedRows()).toEqual(applied);
    });

    it("keeps every file and the new definition when an earlier file applied and a later one failed", async () => {
      await writeCollectionSave(translatedDeps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("title")]),
        change: "create",
      });
      await adapter.executeQuery(
        "INSERT INTO dc_posts (id, title, slug, created_at, updated_at) VALUES ('p1', 'Hello', 'p1', '2026-11-06 00:00:00', '2026-11-06 00:00:00')"
      );
      // A translations table of another shape: the file's CREATE ... IF NOT EXISTS keeps it, and
      // its copy of the rows into it fails, after the main file applied.
      const key = dialect === "mysql" ? "VARCHAR(36)" : "TEXT";
      await adapter.executeQuery(
        `CREATE TABLE dc_posts_locales (_parent ${key} NOT NULL, _locale VARCHAR(20) NOT NULL)`
      );
      const before = migrationFiles();

      await expect(
        writeCollectionSave(translatedDeps(), enableTitle)
      ).rejects.toBeDefined();

      const written = migrationFiles().filter(f => !before.includes(f));
      expect(written.length).toBeGreaterThan(1);
      const applied = (await appliedRows()).map(row => row.filename);
      expect(written.some(f => applied.includes(f))).toBe(true);
      expect(
        (
          JSON.parse(definition() ?? "{}") as {
            collections: { localized?: boolean }[];
          }
        ).collections[0]?.localized
      ).toBe(true);
    });

    it.runIf(dialect === "mysql")(
      "keeps the files of a translations-table change that failed part-way while the collection's own table stood still",
      async () => {
        await writeCollectionSave(translatedDeps(), {
          slug: "posts",
          previous: null,
          entity: translated([text("title", { localized: true })]),
          change: "create",
        });
        // A column the save's second addition collides with, after its first has committed.
        await adapter.executeQuery(
          "ALTER TABLE dc_posts_locales ADD COLUMN b TEXT NULL"
        );
        const before = migrationFiles();

        await expect(
          writeCollectionSave(translatedDeps(), {
            slug: "posts",
            previous: translated([text("title", { localized: true })]),
            entity: translated([
              text("title", { localized: true }),
              text("a", { localized: true }),
              text("b", { localized: true }),
            ]),
            change: "update",
          })
        ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED" });

        expect(migrationFiles().length).toBeGreaterThan(before.length);
      }
    );
  }
);
