/**
 * The migrations a Schema Builder session writes in development, applied by `nextly migrate` to an
 * empty database, give that database the same tables and the same registry rows as the database
 * the session ran on. Each session runs through the dispatchers the admin calls, on every dialect,
 * and covers all three entity kinds. Along the way, every save writes at least one non-empty
 * file, and a save that changes settings alone writes one settings-only file naming the setting.
 *
 * The sessions holding a translated entity whose translations table one file creates and a later
 * file writes rows into are applied with data-loss consent given: `nextly migrate` asks consent for
 * those writes on an empty database, though nothing can be lost, since it judges the later file
 * against a table the earlier one has not made yet.
 */
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { container } from "../../../di/container";
import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import { type DataLossConsent, NO_CONSENT } from "../migrate/data-loss-consent";
import { diffSnapshots } from "../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import { _resetApplyDesiredSchemaForTests } from "../pipeline/index";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

/** Consent to every deletion, as `--accept-data-loss` gives it. */
const ALL_CONSENT: DataLossConsent = {
  given: { from: "flag", targets: "all" },
  earlier: [],
  ignored: [],
};

const TWO_LANGUAGES = {
  localization: { locales: ["en", "es"], defaultLocale: "en" },
};

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/** A database of its own: a file on SQLite, a fresh database on the server elsewhere. */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const dir = await mkdtemp(join(tmpdir(), "nextly-session-replay-"));
    // The directory goes with an adapter that could not be made.
    const adapter = (await createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "test.db")}`,
    } as Parameters<typeof createAdapter>[0]).catch(async (error: unknown) => {
      await rm(dir, { recursive: true, force: true });
      throw error;
    })) as unknown as DrizzleAdapter;
    return {
      adapter,
      async close() {
        await adapter.disconnect().catch(() => {});
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_replay_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  let adapter: DrizzleAdapter;
  try {
    await server.executeQuery(createDatabaseStatement(dialect, name));
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    vi.stubEnv("DATABASE_URL", url.toString());
    _resetEnvCache();
    adapter = (await createAdapter({
      type: dialect,
      url: url.toString(),
    }).catch(async (error: unknown) => {
      // The database made for a connection that failed is dropped with it.
      await server
        .executeQuery(dropDatabaseStatement(dialect, name))
        .catch(() => {});
      throw error;
    })) as unknown as DrizzleAdapter;
  } catch (error) {
    // The server connection is released whatever step of the setup failed.
    await server.disconnect().catch(() => {});
    throw error;
  }
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

/** A Builder save as a development server runs it, where a save applies its change at once. */
async function inDevelopment<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await run();
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

/** The tables the Builder's entities own in `adapter`'s database, by name. */
async function entityTables(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<string[]> {
  const sql =
    dialect === "sqlite"
      ? "SELECT name AS n FROM sqlite_master WHERE type = 'table'"
      : dialect === "postgresql"
        ? "SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public'"
        : "SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()";
  const rows = await adapter.executeQuery<{ n?: string; N?: string }>(sql);
  return rows
    .map(row => String(row.n ?? row.N))
    .filter(name => /^(dc_|single_|comp_)/.test(name))
    .sort();
}

/** Columns of a registry row that differ between two databases by design: ids, times, versions. */
const PER_DATABASE =
  /^(id|created_at|updated_at|created_by|updated_by|migration_status|last_migration_id|schema_hash|schema_version)$/;

/** Every registry row, without its per-database columns, JSON read as values, in slug order. */
async function registryRows(adapter: DrizzleAdapter) {
  const rows: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of [
    "dynamic_collections",
    "dynamic_singles",
    "dynamic_components",
  ]) {
    rows[table] = (
      await adapter.executeQuery<Record<string, unknown>>(
        `SELECT * FROM ${table}`
      )
    )
      .map(row =>
        Object.fromEntries(
          Object.entries(row)
            .filter(([column]) => !PER_DATABASE.test(column))
            .map(([column, value]) => [column, asValue(value)])
            .sort(([a], [b]) => String(a).localeCompare(String(b)))
        )
      )
      .sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  }
  return rows;
}

/** A stored value, a JSON text read as the value it holds, so dialects that store text compare. */
function asValue(value: unknown): unknown {
  if (typeof value !== "string" || !/^[[{]/.test(value.trim())) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** One file a save wrote, as the assertions read it. */
interface WrittenFile {
  name: string;
  text: string;
  /** The lines of its UP section that are statements, not comments. */
  statements: string[];
}

type Dispatch = (
  op: string,
  params: Record<string, unknown>,
  body: unknown
) => Promise<unknown>;

/** What a session's steps are given: a step that records its files, and the three dispatchers. */
interface SessionTools {
  /** Run one save, which must succeed, and answer the files it wrote. */
  save: (run: () => Promise<unknown>) => Promise<WrittenFile[]>;
  collections: Dispatch;
  singles: Dispatch;
  fieldGroups: Dispatch;
  versionOf: (registry: string, slug: string) => Promise<number>;
  database: CaseDatabase;
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`a Builder session's migrations replayed on an empty database — ${dialect}`, () => {
    let database: CaseDatabase | undefined;
    let projectRoot: string;

    /** This case's database, once its setup has made it. */
    const source = (): CaseDatabase => {
      if (database === undefined) throw new Error("no database for this case");
      return database;
    };

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-session-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      clearCachedSnapshot();
      database = await openDatabase(dialect);
    });

    afterEach(async () => {
      // The process is put back even where closing the database fails.
      try {
        clearServices();
        clearCachedSnapshot();
        await database?.close();
      } finally {
        database = undefined;
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        _resetEnvCache();
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    /**
     * Run `session` on this case's database, then apply the folder it wrote to an empty database
     * with `consent`, and expect the two to hold the same tables and registry rows.
     */
    async function replayed(
      boot: Record<string, unknown>,
      consent: DataLossConsent,
      session: (tools: SessionTools) => Promise<void>
    ): Promise<void> {
      const database = source();
      clearServices();
      _resetApplyDesiredSchemaForTests();
      const sessionNextly = await createTestNextly({
        adapter: database.adapter as never,
        ...boot,
      });
      const { migrationsDir } = container.get<{ migrationsDir: string }>(
        "builderSaveSetup"
      );
      const seen = new Set<string>();
      const save = async (run: () => Promise<unknown>) => {
        const answer = await inDevelopment(run);
        // A dispatcher answers a refusal as a response, or throws it.
        if (answer instanceof Response) {
          expect(answer.ok, await answer.clone().text()).toBe(true);
        }
        const written: WrittenFile[] = [];
        for (const name of (await readdir(migrationsDir))
          .filter(file => file.endsWith(".sql"))
          .sort()) {
          if (seen.has(name)) continue;
          seen.add(name);
          const text = await readFile(join(migrationsDir, name), "utf-8");
          const up = text.split("-- DOWN")[0] ?? "";
          written.push({
            name,
            text,
            statements: up
              .split("\n")
              .filter(line => line.trim() !== "" && !line.startsWith("--")),
          });
        }
        // Every save writes, and nothing it writes is empty: each file changes a table, or
        // records a setting or a permission.
        expect(written.length, "files the save wrote").toBeGreaterThan(0);
        for (const file of written) {
          expect(
            file.statements.length > 0 ||
              /^-- (Settings|Permissions):/m.test(file.text),
            `${file.name} holds a change`
          ).toBe(true);
        }
        return written;
      };
      const versionOf = async (registry: string, slug: string) => {
        const [row] = await database.adapter.executeQuery<{ v: unknown }>(
          `SELECT schema_version AS v FROM ${registry} WHERE slug = '${slug}'`
        );
        return Number(row?.v ?? 1);
      };
      await session({
        save,
        collections: (op, params, body) =>
          dispatchCollections(
            {} as ServiceContainer,
            op as never,
            params as never,
            body as never
          ),
        singles: (op, params, body) =>
          dispatchSingles(op as never, params as never, body as never),
        fieldGroups: (op, params, body) =>
          dispatchComponents(op as never, params as never, body as never),
        versionOf,
        database,
      });

      const tables = await entityTables(database.adapter, dialect);
      const schema = await introspectLiveSnapshot(
        database.adapter.getDrizzle(),
        dialect,
        tables
      );
      const registry = await registryRows(database.adapter);
      // Copied while the session's instance still owns the folder: the next boot replaces it.
      const folder = await mkdtemp(join(tmpdir(), "nextly-session-files-"));
      await cp(migrationsDir, folder, { recursive: true });
      // The session's instance drains its work and lets its database go before the replay boots.
      await sessionNextly.destroy();
      const replay = await openDatabase(dialect);
      let replayNextly:
        | Awaited<ReturnType<typeof createTestNextly>>
        | undefined;
      try {
        clearServices();
        _resetApplyDesiredSchemaForTests();
        replayNextly = await createTestNextly({
          adapter: replay.adapter as never,
          ...boot,
        });
        const result = (await migrateCore({
          extensionSchema: undefined,
          dialect,
          db: replay.adapter.getDrizzle(),
          adapter: replay.adapter as never,
          migrationsDir: folder,
          logger: createLogger({ quiet: true }),
          lockMode: "fail-fast",
          consent,
          interactive: false,
        } as never)) as { applied: number };

        expect(result.applied).toBe(seen.size);
        const replayedTables = await entityTables(replay.adapter, dialect);
        expect(replayedTables).toEqual(tables);
        expect(
          diffSnapshots(
            schema,
            await introspectLiveSnapshot(
              replay.adapter.getDrizzle(),
              dialect,
              replayedTables
            )
          )
        ).toEqual([]);
        expect(await registryRows(replay.adapter)).toEqual(registry);
      } finally {
        try {
          await replayNextly?.destroy();
        } finally {
          await replay.close();
          await rm(folder, { recursive: true, force: true });
        }
      }
    }

    /**
     * A save of settings alone writes one file, naming `setting` of `slug`, whose UP writes the
     * registry row and nothing else: no table changed, and no entry written.
     */
    function expectSettingsOnly(
      written: WrittenFile[],
      slug: string,
      setting: string
    ) {
      expect(written.map(file => file.name)).toHaveLength(1);
      const [file] = written;
      expect(file?.text).toContain(`-- Settings: ${slug}: ${setting}`);
      const statements =
        file?.statements.join("\n").split(/;\s*(?:\n|$)/) ?? [];
      const writes = statements
        .map(statement => statement.trim())
        .filter(Boolean);
      expect(writes.length, file?.text).toBeGreaterThan(0);
      for (const statement of writes) {
        expect(statement.slice(0, 120)).toMatch(
          /^INSERT INTO [`"]?(dynamic_collections|dynamic_singles|dynamic_components)[`"]?[\s(]/i
        );
      }
    }

    it("replays creates, edits, a rename, settings saves and deletes of every kind to the same tables and registry rows", async () => {
      let descriptions: Record<string, unknown> = {};
      await replayed({}, NO_CONSENT, async tools => {
        const { save, collections, singles, fieldGroups, versionOf } = tools;
        const posts = (extra: Record<string, unknown>[] = []) => [
          { name: "headline", type: "text" },
          { name: "author", type: "relationship", relationTo: "authors" },
          ...extra,
        ];
        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "authors",
              label: "Authors",
              fields: [{ name: "name", type: "text" }],
            }
          )
        );
        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "posts",
              label: "Posts",
              fields: posts(),
            }
          )
        );
        await save(() =>
          collections(
            "updateCollection",
            { collectionName: "posts" },
            {
              fields: posts([{ name: "subtitle", type: "text" }]),
            }
          )
        );
        await save(async () =>
          collections(
            "applySchemaChanges",
            { collectionName: "posts" },
            {
              fields: posts([{ name: "summary", type: "text" }]),
              confirmed: true,
              schemaVersion: await versionOf("dynamic_collections", "posts"),
              eventResolutions: [],
              renameResolutions: [
                {
                  tableName: "dc_posts",
                  fromColumn: "subtitle",
                  toColumn: "summary",
                  choice: "rename",
                },
              ],
            }
          )
        );
        // The settings page sends the whole field list with the settings; a save may send none.
        expectSettingsOnly(
          await save(() =>
            collections(
              "updateCollection",
              { collectionName: "posts" },
              {
                description: "Everything we publish",
                fields: posts([{ name: "summary", type: "text" }]),
              }
            )
          ),
          "posts",
          "description"
        );
        expectSettingsOnly(
          await save(() =>
            collections(
              "updateCollection",
              { collectionName: "posts" },
              {
                description: "Everything we publish, now",
              }
            )
          ),
          "posts",
          "description"
        );
        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "drafts",
              label: "Drafts",
              fields: [{ name: "note", type: "text" }],
            }
          )
        );
        await save(() =>
          collections(
            "deleteCollection",
            { collectionName: "drafts" },
            undefined
          )
        );

        await save(() =>
          singles(
            "createSingle",
            {},
            {
              slug: "site",
              label: "Site",
              fields: [{ name: "heading", type: "text" }],
            }
          )
        );
        const siteFields = [
          { name: "heading", type: "text" },
          { name: "body", type: "text" },
        ];
        await save(() =>
          singles(
            "updateSingleSchema",
            { slug: "site" },
            { fields: siteFields }
          )
        );
        expectSettingsOnly(
          await save(() =>
            singles(
              "updateSingleSchema",
              { slug: "site" },
              {
                description: "The site's settings",
                fields: siteFields,
              }
            )
          ),
          "site (single)",
          "description"
        );

        await save(() =>
          fieldGroups(
            "createComponent",
            {},
            {
              slug: "meta",
              label: "Meta",
              fields: [{ name: "note", type: "text" }],
            }
          )
        );
        await save(async () =>
          fieldGroups(
            "applyComponentSchemaChanges",
            { slug: "meta" },
            {
              fields: [
                { name: "note", type: "text" },
                { name: "count", type: "number" },
              ],
              confirmed: true,
              schemaVersion: await versionOf("dynamic_components", "meta"),
            }
          )
        );
        expectSettingsOnly(
          await save(() =>
            fieldGroups(
              "updateComponent",
              { slug: "meta" },
              {
                description: "Page meta",
              }
            )
          ),
          "meta (field group)",
          "description"
        );
        descriptions = Object.fromEntries(
          Object.entries(await registryRows(tools.database.adapter)).flatMap(
            ([, rows]) => rows.map(row => [row.slug, row.description])
          )
        );
      });
      // The registries compared hold the saved settings, so equal rows are not two empty ones.
      expect(descriptions).toMatchObject({
        posts: "Everything we publish, now",
        site: "The site's settings",
        meta: "Page meta",
      });
      expect(descriptions).not.toHaveProperty("drafts");
    }, 600_000);

    it("replays a many-to-many, a type change, a relationship switch, translated entities and deletes, with consent given", async () => {
      await replayed(TWO_LANGUAGES, ALL_CONSENT, async tools => {
        const { save, collections, singles, fieldGroups, versionOf } = tools;
        const posts = (
          change: (f: Record<string, unknown>) => Record<string, unknown> = f =>
            f
        ) =>
          [
            { name: "headline", type: "text" },
            { name: "rank", type: "number" },
            { name: "author", type: "relationship", relationTo: "authors" },
            {
              name: "tags",
              type: "relationship",
              relationTo: "tags",
              hasMany: true,
              options: { target: "tags", relationType: "manyToMany" },
            },
          ].map(change);
        const applyPosts = async (fields: unknown[]) =>
          collections(
            "applySchemaChanges",
            { collectionName: "posts" },
            {
              fields,
              confirmed: true,
              schemaVersion: await versionOf("dynamic_collections", "posts"),
              eventResolutions: [],
              renameResolutions: [],
            }
          );
        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "tags",
              label: "Tags",
              fields: [{ name: "label", type: "text" }],
            }
          )
        );
        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "authors",
              label: "Authors",
              fields: [{ name: "name", type: "text" }],
            }
          )
        );
        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "posts",
              label: "Posts",
              fields: posts(),
            }
          )
        );
        const rankAsText = (f: Record<string, unknown>) =>
          f.name === "rank" ? { name: "rank", type: "text" } : f;
        await save(() => applyPosts(posts(rankAsText)));
        await save(() =>
          applyPosts(
            posts(f =>
              f.name === "author"
                ? {
                    name: "author",
                    type: "relationship",
                    relationTo: "authors",
                    hasMany: true,
                  }
                : rankAsText(f)
            )
          )
        );

        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "articles",
              label: "Articles",
              localized: true,
              fields: [
                { name: "title", type: "text", localized: true },
                { name: "code", type: "text" },
              ],
            }
          )
        );
        await save(async () =>
          collections(
            "applySchemaChanges",
            { collectionName: "articles" },
            {
              fields: [
                { name: "title", type: "text", localized: true },
                { name: "code", type: "text", localized: true },
              ],
              confirmed: true,
              localized: true,
              schemaVersion: await versionOf("dynamic_collections", "articles"),
              eventResolutions: [],
              renameResolutions: [],
            }
          )
        );
        expectSettingsOnly(
          await save(() =>
            collections(
              "updateCollection",
              { collectionName: "articles" },
              {
                description: "Translated",
              }
            )
          ),
          "articles",
          "description"
        );

        await save(() =>
          singles(
            "createSingle",
            {},
            {
              slug: "banner",
              label: "Banner",
              localized: true,
              fields: [{ name: "text", type: "text", localized: true }],
            }
          )
        );
        await save(() =>
          singles(
            "updateSingleSchema",
            { slug: "banner" },
            {
              fields: [
                { name: "text", type: "text", localized: true },
                { name: "link", type: "text" },
              ],
            }
          )
        );
        await save(() =>
          singles(
            "createSingle",
            {},
            {
              slug: "gone",
              label: "Gone",
              fields: [{ name: "x", type: "text" }],
            }
          )
        );
        await save(() => singles("deleteSingle", { slug: "gone" }, undefined));
        await save(() =>
          fieldGroups(
            "createComponent",
            {},
            {
              slug: "spare",
              label: "Spare",
              fields: [{ name: "y", type: "text" }],
            }
          )
        );
        await save(() =>
          fieldGroups("deleteComponent", { slug: "spare" }, undefined)
        );
      });
    }, 600_000);

    it("replays a field group inside a collection, a unique and a filled required field, cleared and switched settings, and translation turned on and off, with consent given", async () => {
      await replayed(TWO_LANGUAGES, ALL_CONSENT, async tools => {
        const {
          save,
          collections,
          singles,
          fieldGroups,
          versionOf,
          database: db,
        } = tools;
        const applyTo = async (slug: string, fields: unknown[], extra = {}) =>
          collections(
            "applySchemaChanges",
            { collectionName: slug },
            {
              fields,
              confirmed: true,
              schemaVersion: await versionOf("dynamic_collections", slug),
              eventResolutions: [],
              renameResolutions: [],
              ...extra,
            }
          );
        await save(() =>
          fieldGroups(
            "createComponent",
            {},
            {
              slug: "seo",
              label: "SEO",
              fields: [{ name: "keywords", type: "text" }],
            }
          )
        );
        const headline = { name: "headline", type: "text" };
        const seo = { name: "seo", type: "component", component: "seo" };
        const code = { name: "code", type: "text", unique: true };
        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "posts",
              label: "Posts",
              fields: [headline],
            }
          )
        );
        await save(() => applyTo("posts", [headline, seo]));
        await save(() => applyTo("posts", [headline, seo, code]));
        // A required field added over a row, the row filled with the value given for it.
        const q = (name: string) =>
          dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
        await db.adapter.executeQuery(
          `INSERT INTO ${q("dc_posts")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("headline")}) VALUES ('p1', 'One', 'one', 'One')`
        );
        await save(() =>
          applyTo(
            "posts",
            [
              headline,
              seo,
              code,
              { name: "tagline", type: "text", required: true },
            ],
            {
              resolutions: {
                tagline: { action: "provide_default", value: "Filled" },
              },
            }
          )
        );
        // The row already there holds the value given for it, not another one or none.
        const [filled] = await db.adapter.executeQuery<{ tagline: unknown }>(
          `SELECT ${q("tagline")} AS ${q("tagline")} FROM ${q("dc_posts")} WHERE ${q("id")} = 'p1'`
        );
        expect(filled?.tagline).toBe("Filled");
        const update = (body: unknown) =>
          save(() =>
            collections("updateCollection", { collectionName: "posts" }, body)
          );
        expectSettingsOnly(
          await update({ description: "Set" }),
          "posts",
          "description"
        );
        // A cleared description travels as the empty text it is.
        expectSettingsOnly(
          await update({ description: "" }),
          "posts",
          "description"
        );
        expectSettingsOnly(
          await update({ versions: true }),
          "posts",
          "versions"
        );
        await update({ status: true });

        await save(() =>
          collections(
            "createCollection",
            {},
            {
              name: "articles",
              label: "Articles",
              fields: [
                { name: "title", type: "text" },
                { name: "code", type: "text" },
              ],
            }
          )
        );
        await save(() =>
          collections(
            "updateCollection",
            { collectionName: "articles" },
            {
              localized: true,
            }
          )
        );
        await save(() =>
          applyTo(
            "articles",
            [
              { name: "title", type: "text", localized: true },
              { name: "code", type: "text" },
            ],
            { localized: true }
          )
        );
        await save(() =>
          applyTo(
            "articles",
            [
              { name: "title", type: "text" },
              { name: "code", type: "text" },
            ],
            { localized: true }
          )
        );

        await save(() =>
          singles(
            "createSingle",
            {},
            {
              slug: "banner",
              label: "Banner",
              localized: true,
              fields: [{ name: "text", type: "text", localized: true }],
            }
          )
        );
        expectSettingsOnly(
          await save(() =>
            singles(
              "updateSingleSchema",
              { slug: "banner" },
              {
                description: "Top",
                fields: [{ name: "text", type: "text", localized: true }],
              }
            )
          ),
          "banner (single)",
          "description"
        );
        expectSettingsOnly(
          await save(() =>
            fieldGroups(
              "updateComponent",
              { slug: "seo" },
              {
                description: "Search",
              }
            )
          ),
          "seo (field group)",
          "description"
        );
      });
    }, 600_000);
  });
}
