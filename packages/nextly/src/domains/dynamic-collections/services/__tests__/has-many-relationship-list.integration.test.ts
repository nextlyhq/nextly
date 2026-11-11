/**
 * A relationship that holds a list (`hasMany: true`, or several target collections) is stored as a
 * list, with no single-column foreign key on it, whichever road created its collection, on every
 * dialect: so saving and reading two related ids works. Driven through the Schema Builder's own
 * dispatch, against a database per case, as a development server applies it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../../database/test-database-ddl";
import { container } from "../../../../di/container";
import { clearServices } from "../../../../di/register";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { SchemaEventsRepository } from "../../../schema/events/schema-events-repository";
import { introspectLiveSnapshot } from "../../../schema/pipeline/diff/introspect-live";
import { _resetApplyDesiredSchemaForTests } from "../../../schema/pipeline/index";

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
    const dir = await mkdtemp(join(tmpdir(), "nextly-has-many-"));
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
  const name = `nextly_hm_${randomBytes(8).toString("hex")}`;
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

const createCollection = (
  name: string,
  fields: Array<Record<string, unknown>>
) =>
  inDevelopment(() =>
    dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name, label: name, fields }
    )
  );

type Field = Record<string, unknown> & { name: string };

/** The `posts` registry row's fields and schema version, as stored. */
async function storedPosts(
  adapter: DrizzleAdapter
): Promise<{ fields: Field[]; version: number }> {
  const [row] = await adapter.executeQuery<Record<string, unknown>>(
    `SELECT fields, schema_version FROM dynamic_collections WHERE slug = 'posts'`
  );
  const fields = row?.fields;
  return {
    fields: (typeof fields === "string"
      ? JSON.parse(fields)
      : fields) as Field[],
    version: Number(row?.schema_version ?? 1),
  };
}

/**
 * A Builder apply of `posts` with `author` switched to many or to one, or to the targets given:
 * `authors` alone unless it says otherwise.
 */
async function switchAuthor(
  adapter: DrizzleAdapter,
  to:
    | boolean
    | {
        relationTo: string | string[];
        hasMany?: boolean;
        required?: boolean;
      }
): Promise<{ accepted: true } | { refused: string }> {
  const stored = await storedPosts(adapter);
  const { relationTo, hasMany, required } =
    typeof to === "boolean"
      ? { relationTo: "authors", hasMany: to, required: false }
      : {
          relationTo: to.relationTo,
          hasMany: to.hasMany === true,
          required: to.required === true,
        };
  // The relationship as the Builder sends it to apply: its target and cardinality, with no
  // `options` (which an apply reads as a select field's choices).
  const fields = stored.fields.map(f =>
    f.name === "author"
      ? {
          name: "author",
          type: "relationship",
          relationTo,
          hasMany,
          ...(required ? { required } : {}),
        }
      : f
  );
  try {
    await inDevelopment(() =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields,
          confirmed: true,
          schemaVersion: stored.version,
          eventResolutions: [],
          renameResolutions: [],
        }
      )
    );
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

/** A Builder apply of `posts` with its stored fields mapped as given, and the rename answers given. */
async function applyPosts(
  adapter: DrizzleAdapter,
  map: (field: Field) => Field,
  renameResolutions: unknown[] = []
): Promise<{ accepted: true } | { refused: string }> {
  const stored = await storedPosts(adapter);
  try {
    await inDevelopment(() =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: stored.fields.map(map),
          confirmed: true,
          schemaVersion: stored.version,
          eventResolutions: [],
          renameResolutions,
        }
      )
    );
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

for (const dialect of getConfiguredTestDialects()) {
  describe(`a relationship holding a list — ${dialect}`, () => {
    let database: CaseDatabase;
    let projectRoot: string;

    async function boot(): Promise<TestNextly> {
      clearServices();
      _resetApplyDesiredSchemaForTests();
      return createTestNextly({ adapter: database.adapter as never });
    }

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-has-many-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
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

    /** The foreign keys the live table declares, by the column they constrain. */
    async function foreignKeyColumns(table: string): Promise<string[]> {
      const live = await introspectLiveSnapshot(
        database.adapter.getDrizzle(),
        dialect,
        [table]
      );
      return (live.tables[0]?.foreignKeys ?? []).flatMap(fk => fk.columns);
    }

    it("stores a hasMany relationship the Builder creates as a list, and saves and reads two ids", async () => {
      const t = await boot();
      await createCollection("authors", [{ name: "name", type: "text" }]);
      await createCollection("posts", [
        {
          name: "writers",
          type: "relationship",
          relationTo: "authors",
          hasMany: true,
          // As the create path takes a relationship: its target and relation type as options too.
          options: { target: "authors", relationType: "manyToOne" },
        },
      ]);
      const a = await t.nextly.create({
        collection: "authors",
        data: { title: "A", name: "A" },
      });
      const b = await t.nextly.create({
        collection: "authors",
        data: { title: "B", name: "B" },
      });
      const ids = [a.item.id, b.item.id] as string[];
      const post = await t.nextly.create({
        collection: "posts",
        data: { title: "P", writers: ids },
      });
      const read = (await t.nextly.findByID({
        collection: "posts",
        id: post.item.id as string,
        depth: 0,
      })) as unknown as { writers: unknown };
      expect(read.writers).toEqual(ids);
      expect(await foreignKeyColumns("dc_posts")).not.toContain("writers");
    });

    /**
     * `authors` a and b, a `tags` collection, and `posts` whose `author` relationship is one or
     * many as given, to `authors` alone unless several targets are given.
     */
    async function postsWithAuthors(
      t: TestNextly,
      hasMany: boolean,
      relationTo: string | string[] = "authors",
      required = false
    ) {
      await createCollection("authors", [{ name: "name", type: "text" }]);
      await createCollection("tags", [{ name: "label", type: "text" }]);
      await createCollection("posts", [
        {
          name: "author",
          type: "relationship",
          relationTo,
          hasMany,
          ...(required ? { required } : {}),
          options: { target: "authors", relationType: "manyToOne" },
        },
      ]);
      const a = (
        await t.nextly.create({
          collection: "authors",
          data: { title: "A", name: "A" },
        })
      ).item.id as string;
      const b = (
        await t.nextly.create({
          collection: "authors",
          data: { title: "B", name: "B" },
        })
      ).item.id as string;
      return { a, b };
    }

    async function authorOf(t: TestNextly, id: string): Promise<unknown> {
      return (
        (await t.nextly.findByID({
          collection: "posts",
          id,
          depth: 0,
        })) as unknown as { author: unknown }
      ).author;
    }

    it("switches a relationship from one to many, keeping each value as a one-item list", async () => {
      const t = await boot();
      const { a } = await postsWithAuthors(t, false);
      const withAuthor = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P1", author: a },
        })
      ).item.id as string;
      const without = (
        await t.nextly.create({ collection: "posts", data: { title: "P2" } })
      ).item.id as string;

      expect(await switchAuthor(database.adapter, true)).toEqual({
        accepted: true,
      });
      expect(await authorOf(t, withAuthor)).toEqual([a]);
      expect([null, []]).toContainEqual(await authorOf(t, without));
      expect(await foreignKeyColumns("dc_posts")).not.toContain("author");
    });

    it("switches a relationship from many to one when no row holds more than one", async () => {
      const t = await boot();
      const { a } = await postsWithAuthors(t, true);
      const one = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P1", author: [a] },
        })
      ).item.id as string;
      const none = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P2", author: [] },
        })
      ).item.id as string;

      expect(await switchAuthor(database.adapter, false)).toEqual({
        accepted: true,
      });
      expect(await authorOf(t, one)).toBe(a);
      expect(await authorOf(t, none)).toBeNull();
    });

    // An older Schema Builder created a hasMany field's column as one reference while its registry
    // row recorded the field as many. The next save finds the row and the field agreeing, so the
    // stored ids are read to tell the column apart, and converted to the list the field holds.
    it("repairs a column an older save created as one reference for a field recorded as many", async () => {
      const t = await boot();
      const { a } = await postsWithAuthors(t, false);
      const post = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P1", author: a },
        })
      ).item.id as string;
      // The registry records the field as many, as that older save did.
      const stored = await storedPosts(database.adapter);
      const recorded = JSON.stringify(
        stored.fields.map(f =>
          f.name === "author"
            ? {
                name: "author",
                type: "relationship",
                relationTo: "authors",
                hasMany: true,
              }
            : f
        )
      ).replace(/'/g, "''");
      await database.adapter.executeQuery(
        `UPDATE dynamic_collections SET fields = '${recorded}' WHERE slug = 'posts'`
      );

      expect(await switchAuthor(database.adapter, true)).toEqual({
        accepted: true,
      });

      expect(await authorOf(t, post)).toEqual([a]);
    });

    it("refuses renaming a relationship and switching it to many in one save, changing nothing", async () => {
      const t = await boot();
      const { a } = await postsWithAuthors(t, false);
      const post = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P1", author: a },
        })
      ).item.id as string;

      const outcome = await applyPosts(
        database.adapter,
        f =>
          f.name === "author"
            ? {
                name: "writer",
                type: "relationship",
                relationTo: "authors",
                hasMany: true,
              }
            : f,
        [
          {
            tableName: "dc_posts",
            fromColumn: "author",
            toColumn: "writer",
            choice: "rename",
          },
        ]
      );
      expect(outcome).toEqual({
        refused: expect.stringContaining(
          "cannot be renamed"
        ) as unknown as string,
      });
      expect(await authorOf(t, post)).toBe(a);
    });

    it("refuses switching a required relationship to one while a row holds none, before anything changes", async () => {
      const t = await boot();
      const { a } = await postsWithAuthors(t, true, "authors", true);
      await t.nextly.create({
        collection: "posts",
        data: { title: "P1", author: [a] },
      });
      const empty = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P2", author: [a] },
        })
      ).item.id as string;
      // A row holding no entry, as the backfill leaves the rows a Required list field is added
      // over: the write path refuses an empty list for a Required field, so it is written here.
      await database.adapter.executeQuery(
        `UPDATE dc_posts SET author = '[]' WHERE id = '${empty}'`
      );

      const outcome = await switchAuthor(database.adapter, {
        relationTo: "authors",
        required: true,
      });
      expect(outcome).toEqual({
        refused: expect.stringContaining("'author'") as unknown as string,
      });
      expect((outcome as { refused: string }).refused).toContain("1 row");
      expect(await authorOf(t, empty)).toEqual([]);
    });

    it("adds a required hasMany relationship over rows, filling each with an empty list before requiring it", async () => {
      const t = await boot();
      await postsWithAuthors(t, false);
      const existing = (
        await t.nextly.create({ collection: "posts", data: { title: "P1" } })
      ).item.id as string;

      // The Builder's collection save: its preflight accepts the column by the backfill literal,
      // and its apply binds the fill between adding the column optional and requiring it. Both
      // come from one storage decision, so a list of ids with no `minRows` is filled with `[]`.
      const stored = await storedPosts(database.adapter);
      const outcome = await inDevelopment(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "updateCollection",
          { collectionName: "posts" },
          {
            // The fields as the save stores them, each relationship naming its target, as
            // `postsWithAuthors` creates them.
            fields: [
              ...stored.fields,
              {
                name: "writers",
                type: "relationship",
                relationTo: "authors",
                hasMany: true,
                required: true,
                options: { target: "authors", relationType: "manyToOne" },
              },
            ],
          }
        )
      ).then(
        () => "accepted",
        // A refused save names its reason in the service's own message, which the envelope
        // carries in the log context behind the generic public one.
        (error: unknown) => {
          const e = error as {
            logContext?: { legacyMessage?: string };
            message?: string;
          };
          return String(e.logContext?.legacyMessage ?? e.message);
        }
      );
      expect(outcome).toBe("accepted");

      const [row] = await database.adapter.executeQuery<{ writers: unknown }>(
        `SELECT writers FROM dc_posts WHERE id = '${existing}'`
      );
      const writers = row?.writers;
      expect(
        typeof writers === "string" ? JSON.parse(writers) : writers
      ).toEqual([]);
      const live = await introspectLiveSnapshot(
        database.adapter.getDrizzle(),
        dialect,
        ["dc_posts"]
      );
      const column = live.tables[0]?.columns.find(c => c.name === "writers");
      expect(column?.nullable).toBe(false);
    });

    it("refuses switching to one while a row holds several, before anything changes", async () => {
      const t = await boot();
      const { a, b } = await postsWithAuthors(t, true);
      const both = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P1", author: [a, b] },
        })
      ).item.id as string;

      const outcome = await switchAuthor(database.adapter, false);
      expect(outcome).toEqual({
        refused: expect.stringContaining("'author'") as unknown as string,
      });
      expect((outcome as { refused: string }).refused).toContain("1 row");
      // Nothing changed: the list is still there, and the registry still says many.
      expect(await authorOf(t, both)).toEqual([a, b]);
      expect(
        (await storedPosts(database.adapter)).fields.find(
          f => f.name === "author"
        )
      ).toMatchObject({ hasMany: true });
    });

    // A relation to several collections holds `{ relationTo, value }` references, which no
    // conversion makes from a bare id or turns back into one: switching to or from it over rows
    // holding values is refused before anything runs, so no row keeps a value of the old shape.
    it("refuses switching to several collections while a row holds a value, changing nothing", async () => {
      const t = await boot();
      const { a } = await postsWithAuthors(t, false);
      const post = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P1", author: a },
        })
      ).item.id as string;

      const outcome = await switchAuthor(database.adapter, {
        relationTo: ["authors", "tags"],
      });
      expect(outcome).toEqual({
        refused: expect.stringContaining("'author'") as unknown as string,
      });
      expect((outcome as { refused: string }).refused).toContain("1 row");
      expect(await authorOf(t, post)).toBe(a);
      expect(
        (await storedPosts(database.adapter)).fields.find(
          f => f.name === "author"
        )
      ).toMatchObject({ relationTo: "authors" });
    });

    it("refuses switching from several collections to one while a row holds a value", async () => {
      const t = await boot();
      const { a } = await postsWithAuthors(t, false, ["authors", "tags"]);
      const post = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P1", author: { relationTo: "authors", value: a } },
        })
      ).item.id as string;

      const outcome = await switchAuthor(database.adapter, {
        relationTo: "authors",
      });
      expect(outcome).toEqual({
        refused: expect.stringContaining("'author'") as unknown as string,
      });
      expect((outcome as { refused: string }).refused).toContain("1 row");
      expect(await authorOf(t, post)).toMatchObject({
        relationTo: "authors",
        value: a,
      });
    });

    it("switches a list across several collections to one, leaving a row that held an empty list with no value", async () => {
      const t = await boot();
      await postsWithAuthors(t, true, ["authors", "tags"]);
      const post = (
        await t.nextly.create({ collection: "posts", data: { title: "P1" } })
      ).item.id as string;
      // A row holding an empty list, which the switch's guard accepts as no value.
      await database.adapter.executeQuery(
        `UPDATE dc_posts SET author = '[]' WHERE id = '${post}'`
      );

      expect(
        await switchAuthor(database.adapter, { relationTo: "authors" })
      ).toEqual({ accepted: true });
      // Read as stored: the list's empty left under the one reference's shape would read as an id.
      const [row] = await database.adapter.executeQuery<{ author: unknown }>(
        `SELECT author FROM dc_posts WHERE id = '${post}'`
      );
      expect(row?.author ?? null).toBeNull();
    });

    it("switches to several collections when no row holds a value, and then saves and reads one", async () => {
      const t = await boot();
      const { a } = await postsWithAuthors(t, false);
      await t.nextly.create({ collection: "posts", data: { title: "P1" } });

      expect(
        await switchAuthor(database.adapter, {
          relationTo: ["authors", "tags"],
        })
      ).toEqual({ accepted: true });
      const post = (
        await t.nextly.create({
          collection: "posts",
          data: { title: "P2", author: { relationTo: "authors", value: a } },
        })
      ).item.id as string;
      expect(await authorOf(t, post)).toMatchObject({
        relationTo: "authors",
        value: a,
      });
      expect(await foreignKeyColumns("dc_posts")).not.toContain("author");
    });

    it("switches a Single's relationship from one to many, keeping its value as a one-item list", async () => {
      const t = await boot();
      await createCollection("authors", [{ name: "name", type: "text" }]);
      const a = (
        await t.nextly.create({
          collection: "authors",
          data: { title: "A", name: "A" },
        })
      ).item.id as string;
      const author = (hasMany: boolean) => ({
        name: "author",
        type: "relationship",
        relationTo: "authors",
        hasMany,
      });
      await inDevelopment(() =>
        dispatchSingles(
          "createSingle",
          {},
          {
            slug: "site",
            label: "Site",
            fields: [
              {
                ...author(false),
                options: { target: "authors", relationType: "manyToOne" },
              },
            ],
          }
        )
      );
      // A first write, so there is no version to send back.
      await t.nextly.updateSingle({
        slug: "site",
        data: { author: a, _overwrite: true },
      });
      const [row] = await database.adapter.executeQuery<{
        schema_version: unknown;
      }>(`SELECT schema_version FROM dynamic_singles WHERE slug = 'site'`);

      await inDevelopment(() =>
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "site" },
          {
            fields: [author(true)],
            confirmed: true,
            schemaVersion: Number(row?.schema_version ?? 1),
            eventResolutions: [],
            renameResolutions: [],
          }
        )
      );

      const site = (await t.nextly.findSingle({
        slug: "site",
        depth: 0,
      })) as unknown as { author: unknown };
      expect(site.author).toEqual([a]);
      expect(await foreignKeyColumns("single_site")).not.toContain("author");
    });

    it("stores a relationship to several collections the Builder creates as a list", async () => {
      const t = await boot();
      await createCollection("authors", [{ name: "name", type: "text" }]);
      await createCollection("tags", [{ name: "label", type: "text" }]);
      await createCollection("posts", [
        {
          name: "subject",
          type: "relationship",
          relationTo: ["authors", "tags"],
          options: { target: "authors", relationType: "manyToOne" },
        },
      ]);
      const a = await t.nextly.create({
        collection: "authors",
        data: { title: "A", name: "A" },
      });
      const post = await t.nextly.create({
        collection: "posts",
        data: {
          title: "P",
          subject: { relationTo: "authors", value: a.item.id },
        },
      });
      const read = (await t.nextly.findByID({
        collection: "posts",
        id: post.item.id as string,
        depth: 0,
      })) as unknown as { subject: unknown };
      expect(read.subject).toMatchObject({
        relationTo: "authors",
        value: a.item.id,
      });
      expect(await foreignKeyColumns("dc_posts")).not.toContain("subject");
    });

    // One switch, the same outcome whichever road the save takes: the Schema Builder's writer (the
    // save writes its migration and runs it) or the push the save took before it (here, the writer
    // left unregistered). A relation switching its storage shape is applied by the push either
    // way, so its refusals, conversions and repairs are one implementation.
    describe.each(["the Schema Builder's writer", "the push"])(
      "a relationship switch through %s",
      road => {
        beforeEach(() => {
          if (road !== "the push") return;
          const has = container.has.bind(container);
          vi.spyOn(container, "has").mockImplementation(name =>
            name === "builderSaveSetup" ? false : has(name)
          );
        });

        it("switches one to many, keeping the value as a one-item list", async () => {
          const t = await boot();
          const { a } = await postsWithAuthors(t, false);
          const post = (
            await t.nextly.create({
              collection: "posts",
              data: { title: "P1", author: a },
            })
          ).item.id as string;
          // The writer's migrations, which the push road never writes to.
          const { migrationsDir } = container.get<{ migrationsDir: string }>(
            "builderSaveSetup"
          );
          const sqlFiles = async () =>
            (await readdir(migrationsDir).catch(() => [])).filter(file =>
              file.endsWith(".sql")
            );
          const before = await sqlFiles();

          expect(await switchAuthor(database.adapter, true)).toEqual({
            accepted: true,
          });
          expect(await authorOf(t, post)).toEqual([a]);

          // The writer still writes the switch's migration, recorded applied once the push ran it.
          const added = (await sqlFiles()).filter(
            file => !before.includes(file)
          );
          if (road === "the push") {
            expect(added).toEqual([]);
          } else {
            expect(added).toHaveLength(1);
            expect(
              await new SchemaEventsRepository(
                database.adapter.getDrizzle(),
                dialect
              ).isFileApplied(added[0])
            ).toBe(true);
          }
        });

        it("refuses many to one while a row holds several, naming the field and its rows", async () => {
          const t = await boot();
          const { a, b } = await postsWithAuthors(t, true);
          await t.nextly.create({
            collection: "posts",
            data: { title: "P1", author: [a, b] },
          });
          const outcome = await switchAuthor(database.adapter, false);
          expect(outcome).toEqual({
            refused: expect.stringContaining("'author'") as unknown as string,
          });
          expect((outcome as { refused: string }).refused).toContain("1 row");
        });

        it("refuses a switch to several collections while a row holds a value, naming the field", async () => {
          const t = await boot();
          const { a } = await postsWithAuthors(t, false);
          await t.nextly.create({
            collection: "posts",
            data: { title: "P1", author: a },
          });
          expect(
            await switchAuthor(database.adapter, {
              relationTo: ["authors", "tags"],
            })
          ).toEqual({
            refused: expect.stringContaining("'author'") as unknown as string,
          });
        });

        it("switches to several collections over no value, then saves one", async () => {
          const t = await boot();
          const { a } = await postsWithAuthors(t, false);
          expect(
            await switchAuthor(database.adapter, {
              relationTo: ["authors", "tags"],
            })
          ).toEqual({ accepted: true });
          const post = (
            await t.nextly.create({
              collection: "posts",
              data: {
                title: "P1",
                author: { relationTo: "authors", value: a },
              },
            })
          ).item.id as string;
          expect(await authorOf(t, post)).toMatchObject({
            relationTo: "authors",
            value: a,
          });
        });
      }
    );
  });
}
