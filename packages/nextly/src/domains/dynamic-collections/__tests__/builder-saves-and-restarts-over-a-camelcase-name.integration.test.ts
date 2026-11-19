/**
 * A collection made through the API with a camelCase field name goes through the Schema Builder
 * whole, on every dialect: its save is previewed against the real database, applied, written to
 * the definition file, and read back by the next start.
 *
 * The API keeps `metaTitle` as it is given, in the column `meta_title`. The admin then sends
 * every stored name as it is with a new field beside them: the preview answers for the new field
 * alone, the apply adds its column and keeps `meta_title` and its values, and the definition
 * file records `metaTitle` under its own name. A second start on the same database and the same
 * project folder reads that file, keeps the name, reads the value back, and takes a further
 * Builder save.
 *
 * Every start runs under `NODE_ENV=development`, where a Builder save applies its change at once
 * and writes the definition file.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { loadUiSchema } from "../../schema/ui-schema/loader";

type Field = { name: string; type: string };

const DECLARED: Field[] = [
  { name: "body", type: "text" },
  { name: "metaTitle", type: "text" },
];
const DEFINITION_FILE = "./schema/builder.json";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/**
 * A database both starts of the case connect to: a throwaway one on PostgreSQL and MySQL, and
 * one in-memory SQLite connection.
 */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_cn_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

describe.each(getConfiguredTestDialects())(
  "a collection with a camelCase field name, through the Builder and a restart (%s)",
  dialect => {
    let database: CaseDatabase | undefined;
    let project = "";
    let current: TestNextly | undefined;

    /** A start of the app on the case's database and project folder. */
    async function start(): Promise<TestNextly> {
      clearServices();
      current = await createTestNextly({
        adapter: database!.adapter as never,
        basePath: project,
        collections: [],
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: DEFINITION_FILE,
        },
      });
      return current;
    }

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      database = await openDatabase(dialect);
      project = await mkdtemp(join(tmpdir(), "camelcase-names-int-"));
    }, 120_000);

    afterEach(async () => {
      clearServices();
      current = undefined;
      await database?.close();
      database = undefined;
      await rm(project, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** The registry's field names and schema version for `posts`. */
    async function registered(): Promise<{ names: string[]; version: number }> {
      const [row] = await database!.adapter.executeQuery<{
        fields: unknown;
        schema_version: unknown;
      }>(
        `SELECT ${q("fields")} AS fields, ${q("schema_version")} AS schema_version FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'posts'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      return {
        names: fields.map(field => field.name),
        version: Number(row?.schema_version ?? 1),
      };
    }

    /** The live columns of the collection's table. */
    async function columns(): Promise<string[]> {
      const live = await introspectLiveSnapshot(
        database!.adapter.getDrizzle(),
        database!.adapter.getCapabilities().dialect,
        ["dc_posts"]
      );
      return (live.tables[0]?.columns ?? []).map(column => column.name);
    }

    /** The field names the definition file holds for `posts`, read as the file is on disk. */
    function namesOnDisk(): string[] {
      const definition = JSON.parse(
        readFileSync(join(project, "schema", "builder.json"), "utf-8")
      ) as { collections: { slug: string; fields: Field[] }[] };
      return (
        definition.collections.find(c => c.slug === "posts")?.fields ?? []
      ).map(field => field.name);
    }

    /** A Builder request for `posts`, and its answer's body. */
    async function builder(
      method: "previewSchemaChanges" | "applySchemaChanges",
      fields: Field[]
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const response = (await dispatchCollections(
        {} as ServiceContainer,
        method,
        { collectionName: "posts" },
        method === "previewSchemaChanges"
          ? { fields }
          : {
              fields,
              confirmed: true,
              schemaVersion: (await registered()).version,
            }
      )) as Response;
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    }

    it("is previewed, applied, written to the definition file and read by the next start", async () => {
      const first = await start();
      // Through the API, which keeps the name as given.
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "posts", label: "Posts", fields: DECLARED }
      );
      expect((await registered()).names).toEqual(["body", "metaTitle"]);
      expect(await columns()).toContain("meta_title");
      const created = await first.nextly.create({
        collection: "posts",
        data: { body: "b", metaTitle: "kept" },
      });
      const id = String((created.item as { id: unknown }).id);

      // The Builder's preview, as its Save button asks first: every stored name as it is, and a
      // new field beside them. Read against the real table, it changes nothing.
      const withTeaser = [...DECLARED, { name: "teaser", type: "text" }];
      const columnsBefore = await columns();
      const preview = await builder("previewSchemaChanges", withTeaser);
      expect(preview.status).toBe(200);
      // The new field is the whole of the change: the kept name is unchanged, neither removed,
      // renamed nor given another column.
      expect(preview.body).toMatchObject({
        hasChanges: true,
        hasDestructiveChanges: false,
        changes: {
          added: [{ name: "teaser" }],
          removed: [],
          changed: [],
          unchanged: ["body", "metaTitle"],
        },
        renamed: [],
      });
      expect(await columns()).toEqual(columnsBefore);

      // The apply.
      const applied = await builder("applySchemaChanges", withTeaser);
      expect(applied.status).toBe(200);
      expect((await registered()).names).toEqual([
        "body",
        "metaTitle",
        "teaser",
      ]);
      expect(await columns()).toEqual(
        expect.arrayContaining(["body", "meta_title", "teaser"])
      );
      // The definition file records the name as it is.
      expect(namesOnDisk()).toEqual(["body", "metaTitle", "teaser"]);

      // The next start, on the same database and project folder, reads the file.
      const second = await start();
      const loaded = await loadUiSchema({
        projectRoot: project,
        uiSchemaFile: DEFINITION_FILE,
      });
      expect(
        loaded.collections
          .find(c => c.slug === "posts")
          ?.fields.map(f => f.name)
      ).toEqual(["body", "metaTitle", "teaser"]);
      expect((await registered()).names).toEqual([
        "body",
        "metaTitle",
        "teaser",
      ]);
      expect(namesOnDisk()).toEqual(["body", "metaTitle", "teaser"]);
      expect(
        await second.nextly.findByID({ collection: "posts", id })
      ).toMatchObject({ body: "b", metaTitle: "kept" });
      // And writes under the name still land in its column.
      const later = await second.nextly.create({
        collection: "posts",
        data: { body: "c", metaTitle: "after restart" },
      });
      expect(later.item).toMatchObject({ metaTitle: "after restart" });

      // The Builder still takes the collection after the restart, and still refuses a camelCase
      // name the collection does not hold.
      const again = await builder("applySchemaChanges", [
        ...withTeaser,
        { name: "subtitle", type: "text" },
      ]);
      expect(again.status).toBe(200);
      expect((await registered()).names).toEqual([
        "body",
        "metaTitle",
        "teaser",
        "subtitle",
      ]);
      const refused: unknown = await builder("previewSchemaChanges", [
        ...withTeaser,
        { name: "subtitle", type: "text" },
        { name: "ogImage", type: "text" },
      ]).then(
        answer => answer,
        (error: unknown) => error
      );
      expect(JSON.stringify(refused)).toContain("INVALID_FIELD_NAME");
    }, 240_000);
  }
);
