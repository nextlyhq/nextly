/**
 * A column made required over rows that would break it is refused on every road, against a real
 * database, before anything runs.
 *
 * Each road is driven with null rows seeded first: a collection through the Builder's apply, a
 * Single through its schema save and through its Builder apply, a field group through its Builder
 * apply while two collections and a Single use it, and the development push (the pipeline the
 * dev server's auto-sync, the HMR reload and `db:sync` share, run without a terminal). Each
 * refusal names the entity, the field and the count, exactly; a field group's names each
 * collection and Single whose rows break it, with its count, and not the one whose rows hold a
 * value. Afterwards the table's columns and their nullability and the registry row are as they
 * were, so nothing ran.
 *
 * The control on the same database: a Builder apply that chooses a value for the empty rows goes
 * through, leaves the column NOT NULL and every row holding a value, which is also what shows the
 * readers above could have seen a change.
 *
 * Every road runs under `NODE_ENV=development`, where a Builder save applies its DDL at once.
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomBytes } from "node:crypto";
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
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import {
  _resetApplyDesiredSchemaForTests,
  applyDesiredSchema,
} from "../pipeline/index";
import { mergeRegisteredCollectionsSafely } from "../pipeline/registered-collections";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/** The database one case boots against, dropped by `close`. */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const dir = await mkdtemp(join(tmpdir(), "nextly-required-nulls-"));
    const adapter = (await createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "test.db")}`,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
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
  const name = `nextly_rn_${randomBytes(8).toString("hex")}`;
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

type Field = Record<string, unknown> & { name: string; type: string };
type Registry = "dynamic_collections" | "dynamic_singles" | "fieldGroups";

/** A Builder save as a development server runs it, where a save applies its DDL at once. */
async function inDevelopment<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await run();
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

/** The registry row of `slug`, as stored. */
async function registryRow(
  adapter: DrizzleAdapter,
  registry: Registry,
  slug: string
): Promise<Record<string, unknown> | null> {
  const table =
    registry === "fieldGroups" ? STORAGE_FORMAT.registryTable : registry;
  const rows = await adapter.executeQuery<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE slug = '${slug}'`
  );
  return rows[0] ?? null;
}

/** The table's columns with whether each takes NULL, by name. */
async function columnsOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  table: string
): Promise<Record<string, boolean>> {
  const query =
    dialect === "sqlite"
      ? `SELECT name, "notnull" AS required FROM pragma_table_info('${table}')`
      : dialect === "postgresql"
        ? `SELECT column_name AS name, is_nullable AS nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
        : `SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`;
  const rows = await adapter.executeQuery<{
    name: string;
    required?: number | string;
    nullable?: string;
  }>(query);
  return Object.fromEntries(
    rows.map(r => [
      r.name,
      dialect === "sqlite" ? Number(r.required) === 0 : r.nullable === "YES",
    ])
  );
}

/** How many rows of `table` hold null in `column`, and how many it has (`rows` is reserved on MySQL). */
async function nullsIn(
  adapter: DrizzleAdapter,
  table: string,
  column: string
): Promise<{ rows: number; nulls: number }> {
  const [row] = await adapter.executeQuery<{
    total: number | string;
    nulls: number | string;
  }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END) AS nulls FROM ${table}`
  );
  return { rows: Number(row?.total), nulls: Number(row?.nulls ?? 0) };
}

/** The entity's fields as its registry row stores them. */
function storedFields(row: Record<string, unknown> | null): Field[] {
  const fields = row?.fields;
  return (typeof fields === "string" ? JSON.parse(fields) : fields) as Field[];
}

/** `fields` with `name` made required. */
const required = (fields: Field[], name: string): Field[] =>
  fields.map(f => (f.name === name ? { ...f, required: true } : f));

/** What a road answered: accepted, or the message its refusal carries. */
async function outcomeOf(
  run: () => Promise<unknown>
): Promise<{ accepted: true } | { refused: string }> {
  try {
    await run();
  } catch (error) {
    const e = error as {
      publicData?: { errors?: { message: string }[] };
      message?: string;
    };
    const messages = e.publicData?.errors?.map(x => x.message);
    return { refused: messages ? messages.join(" ") : String(e.message) };
  }
  return { accepted: true };
}

const madeRequired = (entity: string, field: string, count: number) => {
  const those = count === 1 ? "that row" : "those rows";
  const rows = count === 1 ? "1 row holds" : `${count} rows hold`;
  return `${entity}: field '${field}' cannot become required while ${rows} no value in it. Give ${those} a value first, or keep the field optional.`;
};

const schemaVersionOf = async (
  adapter: DrizzleAdapter,
  registry: Registry,
  slug: string
) => Number((await registryRow(adapter, registry, slug))?.schema_version ?? 1);

const applyCollection = async (
  adapter: DrizzleAdapter,
  fields: Field[],
  eventResolutions: unknown[] = [],
  // The admin dialog's answer to a drop the rename detector paired with an added field.
  renameResolutions: unknown[] = []
) =>
  dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: "posts" },
    {
      fields,
      confirmed: true,
      schemaVersion: await schemaVersionOf(
        adapter,
        "dynamic_collections",
        "posts"
      ),
      eventResolutions,
      renameResolutions,
    }
  );

for (const dialect of getConfiguredTestDialects()) {
  describe(`a column made required over null rows, on every road — ${dialect}`, () => {
    let database: CaseDatabase;
    let projectRoot: string;

    async function boot(): Promise<TestNextly> {
      clearServices();
      _resetApplyDesiredSchemaForTests();
      return createTestNextly({ adapter: database.adapter as never });
    }

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-required-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      // An apply with the same desired schema as an earlier case's would otherwise be skipped.
      clearCachedSnapshot();
      database = await openDatabase(dialect);
    });

    afterEach(async () => {
      clearServices();
      clearCachedSnapshot();
      await database.close();
      vi.restoreAllMocks();
      await rm(projectRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    /** `posts` with an optional `summary`, two entries leaving it empty and one filling it. */
    async function postsWithNulls(t: TestNextly): Promise<void> {
      await inDevelopment(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: "posts",
            label: "Posts",
            fields: [{ name: "summary", type: "text" }],
          }
        )
      );
      for (const summary of [null, null, "filled in"]) {
        await t.nextly.create({
          collection: "posts",
          data: { title: `Post ${String(summary)}`, summary },
        });
      }
    }

    it("refuses a collection's Builder apply, and a chosen value goes through", async () => {
      const t = await boot();
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await postsWithNulls(t);
      const row = await registryRow(adapter, "dynamic_collections", "posts");
      const columns = await columnsOf(adapter, dialect, "dc_posts");
      expect(columns.summary).toBe(true);

      await inDevelopment(async () => {
        expect(
          await outcomeOf(() =>
            applyCollection(adapter, required(storedFields(row), "summary"))
          )
        ).toEqual({
          refused: madeRequired("Collection 'posts'", "summary", 2),
        });
        expect(await columnsOf(adapter, dialect, "dc_posts")).toEqual(columns);
        expect(
          await registryRow(adapter, "dynamic_collections", "posts")
        ).toEqual(row);
        expect(await nullsIn(adapter, "dc_posts", "summary")).toEqual({
          rows: 3,
          nulls: 2,
        });

        // The control: the same change with a value chosen for the empty rows.
        expect(
          await outcomeOf(() =>
            applyCollection(adapter, required(storedFields(row), "summary"), [
              {
                kind: "provide_default",
                eventId: "add_not_null_with_nulls:dc_posts.summary",
                value: "chosen",
              },
            ])
          )
        ).toEqual({ accepted: true });
      });
      expect((await columnsOf(adapter, dialect, "dc_posts")).summary).toBe(
        false
      );
      expect(await nullsIn(adapter, "dc_posts", "summary")).toEqual({
        rows: 3,
        nulls: 0,
      });
    });

    // A NEW required field on a table with rows, answered with a value: the column has to be added
    // before the rows can be filled, so this fails if the fill runs ahead of the ADD COLUMN. Alone,
    // the change takes PostgreSQL's in-memory DDL route; dropping a field in the same save sends
    // PostgreSQL to drizzle-kit instead, the route SQLite and MySQL take for both.
    it.each([
      { variant: "alone", dropSummary: false },
      { variant: "beside a dropped field", dropSummary: true },
    ])(
      "adds a new required field over existing rows when a value is chosen for them ($variant)",
      async ({ dropSummary }) => {
        const t = await boot();
        const adapter = t.adapter as unknown as DrizzleAdapter;
        await postsWithNulls(t);
        const row = await registryRow(adapter, "dynamic_collections", "posts");
        expect(
          await columnsOf(adapter, dialect, "dc_posts")
        ).not.toHaveProperty("headline");
        const fields: Field[] = [
          ...storedFields(row).filter(
            f => !dropSummary || f.name !== "summary"
          ),
          { name: "headline", type: "text", required: true },
        ];

        await inDevelopment(async () => {
          expect(
            await outcomeOf(() =>
              applyCollection(
                adapter,
                fields,
                [
                  {
                    kind: "provide_default",
                    eventId: "add_required_field_no_default:dc_posts.headline",
                    value: "chosen",
                  },
                  // Answered whether or not the detector pairs the drop with the new field: an
                  // answer to an event the apply does not raise is discarded.
                  ...(dropSummary
                    ? [
                        {
                          kind: "confirm_drop",
                          eventId: "destructive_drop:dc_posts.summary",
                        },
                      ]
                    : []),
                ],
                dropSummary
                  ? [
                      {
                        tableName: "dc_posts",
                        fromColumn: "summary",
                        toColumn: "headline",
                        choice: "drop_and_add",
                      },
                    ]
                  : []
              )
            )
          ).toEqual({ accepted: true });
        });
        expect(
          Object.hasOwn(
            await columnsOf(adapter, dialect, "dc_posts"),
            "summary"
          )
        ).toBe(!dropSummary);
        // The column is there and NOT NULL, and every existing row holds the chosen value.
        expect((await columnsOf(adapter, dialect, "dc_posts")).headline).toBe(
          false
        );
        const [chosen] = await adapter.executeQuery<{ n: number | string }>(
          `SELECT COUNT(*) AS n FROM dc_posts WHERE headline = 'chosen'`
        );
        expect(Number(chosen?.n)).toBe(3);
        expect(await nullsIn(adapter, "dc_posts", "headline")).toEqual({
          rows: 3,
          nulls: 0,
        });
        // The registry row carries the new field, required.
        const stored = storedFields(
          await registryRow(adapter, "dynamic_collections", "posts")
        );
        expect(stored.find(f => f.name === "headline")).toMatchObject({
          type: "text",
          required: true,
        });
      }
    );

    // A field renamed and made required in one save, a value chosen for its empty rows: the rename
    // keeps the column and its rows, so the apply renames it, fills the empty ones and makes it
    // NOT NULL. Adding the renamed column again would fail, and on MySQL after the rename committed.
    it("renames a field and makes it required over its empty rows when a value is chosen", async () => {
      const t = await boot();
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await postsWithNulls(t);
      const row = await registryRow(adapter, "dynamic_collections", "posts");
      const fields: Field[] = [
        ...storedFields(row).filter(f => f.name !== "summary"),
        { name: "headline", type: "text", required: true },
      ];
      await inDevelopment(async () => {
        expect(
          await outcomeOf(() =>
            applyCollection(
              adapter,
              fields,
              [
                {
                  kind: "provide_default",
                  eventId: "add_required_field_no_default:dc_posts.headline",
                  value: "chosen",
                },
              ],
              [
                {
                  tableName: "dc_posts",
                  fromColumn: "summary",
                  toColumn: "headline",
                  choice: "rename",
                },
              ]
            )
          )
        ).toEqual({ accepted: true });
      });
      const columns = await columnsOf(adapter, dialect, "dc_posts");
      expect(Object.hasOwn(columns, "summary")).toBe(false);
      expect(columns.headline).toBe(false);
      // The row that had a value keeps it; the two empty ones hold the chosen value.
      const values = await adapter.executeQuery<{ headline: string }>(
        `SELECT headline FROM dc_posts ORDER BY headline`
      );
      expect(values.map(v => v.headline)).toEqual([
        "chosen",
        "chosen",
        "filled in",
      ]);
      // The registry records the field under its new name, required, and not the old one.
      const stored = storedFields(
        await registryRow(adapter, "dynamic_collections", "posts")
      );
      expect(stored.find(f => f.name === "headline")).toMatchObject({
        type: "text",
        required: true,
      });
      expect(stored.some(f => f.name === "summary")).toBe(false);
    });

    it("refuses a Single's schema save and its Builder apply", async () => {
      const t = await boot();
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await inDevelopment(() =>
        dispatchSingles(
          "createSingle",
          {},
          {
            slug: "home",
            label: "Home",
            fields: [
              { name: "tagline", type: "text" },
              { name: "body", type: "text" },
            ],
          }
        )
      );
      // The Single's one row, with `tagline` left empty.
      await t.nextly.updateSingle({
        slug: "home",
        data: { body: "hello", _overwrite: true },
      });
      const row = await registryRow(adapter, "dynamic_singles", "home");
      const columns = await columnsOf(adapter, dialect, "single_home");
      const fields = required(storedFields(row), "tagline");
      const expected = {
        refused: madeRequired("Single 'home'", "tagline", 1),
      };

      await inDevelopment(async () => {
        expect(
          await outcomeOf(() =>
            dispatchSingles("updateSingleSchema", { slug: "home" }, { fields })
          ),
          "schema save"
        ).toEqual(expected);
        expect(await columnsOf(adapter, dialect, "single_home")).toEqual(
          columns
        );
        expect(await registryRow(adapter, "dynamic_singles", "home")).toEqual(
          row
        );

        expect(
          await outcomeOf(async () =>
            dispatchSingles(
              "applySingleSchemaChanges",
              { slug: "home" },
              {
                fields,
                confirmed: true,
                schemaVersion: await schemaVersionOf(
                  adapter,
                  "dynamic_singles",
                  "home"
                ),
              }
            )
          ),
          "Builder apply"
        ).toEqual(expected);
        expect(await columnsOf(adapter, dialect, "single_home")).toEqual(
          columns
        );
        expect(await registryRow(adapter, "dynamic_singles", "home")).toEqual(
          row
        );
      });
      expect(columns.tagline).toBe(true);
    });

    it("refuses a field group's Builder apply, naming each collection and Single whose rows break it", async () => {
      const t = await boot();
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const promo: Field = {
        name: "promo",
        type: "component",
        component: "promo",
      };
      await inDevelopment(async () => {
        await dispatchComponents(
          "createComponent",
          {},
          {
            slug: "promo",
            label: "Promo",
            fields: [
              { name: "label", type: "text" },
              { name: "cta", type: "text" },
            ],
          }
        );
        for (const name of ["posts", "pages"]) {
          await dispatchCollections(
            {} as ServiceContainer,
            "createCollection",
            {},
            { name, label: name, fields: [promo] }
          );
        }
        await dispatchSingles(
          "createSingle",
          {},
          { slug: "home", label: "Home", fields: [promo] }
        );
      });
      // Two posts and the Single leave `cta` empty; the page fills it, so `pages` is not named.
      for (const label of ["a", "b"]) {
        await t.nextly.create({
          collection: "posts",
          data: { title: label, promo: { label } },
        });
      }
      await t.nextly.create({
        collection: "pages",
        data: { title: "p", promo: { label: "p", cta: "go" } },
      });
      await t.nextly.updateSingle({
        slug: "home",
        data: { promo: { label: "h" }, _overwrite: true },
      });
      expect(await nullsIn(adapter, "comp_promo", "cta")).toEqual({
        rows: 4,
        nulls: 3,
      });
      const row = await registryRow(adapter, "fieldGroups", "promo");
      const columns = await columnsOf(adapter, dialect, "comp_promo");

      await inDevelopment(async () => {
        expect(
          await outcomeOf(async () =>
            dispatchComponents(
              "applyComponentSchemaChanges",
              { slug: "promo" },
              {
                fields: required(storedFields(row), "cta"),
                confirmed: true,
                schemaVersion: await schemaVersionOf(
                  adapter,
                  "fieldGroups",
                  "promo"
                ),
              }
            )
          )
        ).toEqual({
          refused:
            "Field group 'promo': field 'cta' cannot become required while 3 rows hold no value in it: 2 in collection 'posts', 1 in Single 'home'. Give those rows a value first, or keep the field optional.",
        });
      });
      expect(await columnsOf(adapter, dialect, "comp_promo")).toEqual(columns);
      expect(await registryRow(adapter, "fieldGroups", "promo")).toEqual(row);
      expect(columns.cta).toBe(true);
    });

    it("refuses the development push, run without a terminal", async () => {
      const t = await boot();
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await postsWithNulls(t);
      const row = await registryRow(adapter, "dynamic_collections", "posts");
      const columns = await columnsOf(adapter, dialect, "dc_posts");
      // The desired schema the auto-sync builds for a Schema Builder collection: its registry row.
      const registry = new CollectionRegistryService(adapter, {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      });
      const collections = await mergeRegisteredCollectionsSafely({}, () =>
        registry.getAllCollections()
      );
      const posts = collections.posts!;

      const result = await applyDesiredSchema(
        {
          collections: {
            posts: {
              ...posts,
              fields: required(
                posts.fields as unknown as Field[],
                "summary"
              ) as unknown as typeof posts.fields,
            },
          },
          singles: {},
          components: {},
        },
        "code",
        { promptChannel: "terminal" }
      );

      expect(result).toMatchObject({
        success: false,
        error: {
          code: "PRECONDITION_FAILED",
          message: madeRequired("Collection 'posts'", "summary", 2),
        },
      });
      expect(await columnsOf(adapter, dialect, "dc_posts")).toEqual(columns);
      expect(
        await registryRow(adapter, "dynamic_collections", "posts")
      ).toEqual(row);
      expect(await nullsIn(adapter, "dc_posts", "summary")).toEqual({
        rows: 3,
        nulls: 2,
      });
    });
  });
}
