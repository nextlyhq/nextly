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
import { DynamicCollectionService } from "../../../dynamic-collections/services/dynamic-collection-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { checksumOf } from "../../migrate/applied-checksums";
import { splitSqlStatements } from "../../migrate/split-sql";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
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

    it("leaves no file and puts the definition back when the statements fail with nothing applied", async () => {
      await writeCollectionSave(deps(), {
        slug: "posts",
        previous: null,
        entity: posts([text("title"), text("code")]),
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
          previous: posts([text("title"), text("code")]),
          entity: posts([text("title"), text("code", { unique: true })]),
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
        previous: posts([text("title"), text("code")]),
        entity: posts([text("title"), text("code"), text("subtitle")]),
        change: "update",
      });
      expect(await columns()).toContain("subtitle");
    });

    it("adopts a collection whose table no snapshot records, then writes the change", async () => {
      // A table an earlier version's Builder made, as it made it: in the database, in no snapshot.
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
      expect(await columns()).toContain("body");

      const result = await writeCollectionSave(deps(), {
        slug: "posts",
        previous: posts([text("body")]),
        entity: posts([text("body"), text("subtitle")]),
        change: "update",
      });

      const files = migrationFiles();
      expect(files).toHaveLength(2);
      expect(files[0]).toMatch(/_posts_adopt\.sql$/);
      expect(files[1]).toMatch(/_posts_update\.sql$/);
      expect(result.files).toEqual(files);
      expect(readFileSync(join(dir, "migrations", files[0]!), "utf-8")).toMatch(
        /CREATE TABLE/
      );
      expect(await columns()).toContain("subtitle");
      expect((await appliedRows()).map(r => r.filename)).toEqual(files);
    });
  }
);
