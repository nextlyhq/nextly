/**
 * A collection created through the services every surface reaches — the admin's route, a
 * plugin's `ctx.services.collections`, the `CollectionsHandler` — writes its definition and
 * migration where the config's `db` block says, and in development runs it as `nextly migrate`
 * does: nothing goes to the old `src/db/migrations/dynamic` folder, on every dialect.
 */
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineFieldGroup, text } from "../../../../config";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { checksumOf } from "../../migrate/applied-checksums";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a collection created through the services (%s)",
  dialect => {
    let t: TestNextly;

    beforeEach(async () => {
      t = await createTestNextly({
        dialect,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
    });

    const created = (
      name: string
    ): Parameters<CollectionService["createCollection"]>[0] =>
      ({
        name,
        label: "Article",
        fields: [{ name: "body", type: "text" }],
      }) as Parameters<CollectionService["createCollection"]>[0];

    it("in development writes the definition and an applied migration where the config says", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");

      await service.createCollection(created("articles"), {});

      const folder = join(t.basePath, "database", "history");
      const files = readdirSync(folder).filter(f => f.endsWith(".sql"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{8}_\d{6}_\d{3}_articles_create\.sql$/);
      expect(readdirSync(join(folder, "meta"))).toEqual([
        files[0]!.replace(/\.sql$/, ".snapshot.json"),
      ]);
      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as { collections: { slug: string }[] };
      expect(definition.collections.map(c => c.slug)).toEqual(["articles"]);
      expect(existsSync(join(t.basePath, "src", "db", "migrations"))).toBe(
        false
      );

      const adapter = t.adapter as unknown as DrizzleAdapter;
      expect(await adapter.tableExists("dc_articles")).toBe(true);
      const repo = new SchemaEventsRepository(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect
      );
      const applied = (await repo.listFileApplies()).filter(
        row => row.status === "applied"
      );
      expect(applied.map(row => [row.filename, row.sha256])).toEqual([
        [files[0], checksumOf(readFileSync(join(folder, files[0]!), "utf-8"))],
      ]);
    });

    it("in development makes a one-to-one's column unique, so a second entry cannot name the same target", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      const relation = (relationType: string) =>
        ({
          name: "profile",
          type: "relationship",
          options: { target: "people", relationType, onDelete: "set null" },
        }) as never;
      await service.createCollection(
        {
          name: "people",
          label: "Person",
          fields: [{ name: "name", type: "text" }],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
      for (const [name, relationType] of [
        ["posts", "oneToOne"],
        ["notes", "manyToOne"],
      ] as const) {
        await service.createCollection(
          {
            name,
            label: name,
            fields: [{ name: "body", type: "text" }, relation(relationType)],
          } as Parameters<CollectionService["createCollection"]>[0],
          {}
        );
      }
      const person = await t.nextly.create({
        collection: "people" as never,
        data: { name: "Ada" } as never,
      });
      const profile = (person.item as { id: string }).id;
      const write = (collection: string, body: string) =>
        t.nextly.create({
          collection: collection as never,
          data: { body, profile } as never,
        });

      // The one-to-one's cardinality is held by the table: a second entry naming the same person
      // is refused.
      await write("posts", "first");
      await expect(write("posts", "second")).rejects.toBeDefined();
      // The control: a many-to-one beside it takes both, so the refusal above is the column's
      // uniqueness and not something else about the write.
      await write("notes", "first");
      await expect(write("notes", "second")).resolves.toBeDefined();
    });

    it("keeps a plugin many-to-one's foreign-key action through the definition into a deploy's registry row", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      const author = {
        name: "author",
        type: "relationship",
        options: {
          target: "people",
          relationType: "manyToOne",
          onDelete: "set null",
        },
      };
      await service.createCollection(created("people"), {});
      await service.createCollection(
        { name: "notes", label: "Note", fields: [author] } as Parameters<
          CollectionService["createCollection"]
        >[0],
        {}
      );

      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as {
        collections: { slug: string; fields: { options?: unknown }[] }[];
      };
      expect(
        definition.collections.find(c => c.slug === "notes")?.fields[0]?.options
      ).toEqual(author.options);
      const setNull = async (on: TestNextly) => {
        const adapter = on.adapter as unknown as DrizzleAdapter;
        const live = await introspectLiveSnapshot(
          adapter.getDrizzle(),
          adapter.getCapabilities().dialect,
          ["dc_notes"]
        );
        return live.tables[0]?.foreignKeys?.find(
          fk => fk.referencesTable === "dc_people"
        )?.onDelete;
      };
      expect(await setNull(t)).toBe("set null");

      // A deploy's empty database replays the folder: the registry row the file
      // writes keeps the field's options, and the key acts as it does here.
      const folder = await mkdtemp(join(tmpdir(), "nextly-save-replay-"));
      try {
        await cp(join(t.basePath, "database", "history"), folder, {
          recursive: true,
        });
        await t.destroy();
        instance = await createTestNextly({ dialect });
        const fresh = instance.adapter as unknown as DrizzleAdapter;
        await runFileMigrations({
          adapter: fresh as never,
          db: fresh.getDrizzle(),
          dialect: fresh.getCapabilities().dialect,
          migrationsDir: folder,
          logger: createLogger({ quiet: true }),
        });
        const rows = (await fresh.executeQuery(
          "SELECT fields FROM dynamic_collections WHERE slug = 'notes'"
        )) as unknown as { fields: unknown }[];
        const fields = rows[0]?.fields;
        expect(
          (typeof fields === "string" ? JSON.parse(fields) : fields) as unknown
        ).toEqual([author]);
        expect(await setNull(instance)).toBe("set null");
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("in development deletes the collection through its own applied drop file", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});

      await service.deleteCollection("articles", {});

      const folder = join(t.basePath, "database", "history");
      const files = readdirSync(folder)
        .filter(f => f.endsWith(".sql"))
        .sort();
      expect(files.map(f => f.replace(/^\d{8}_\d{6}_\d{3}_/, ""))).toEqual([
        "articles_create.sql",
        "articles_delete.sql",
      ]);
      const adapter = t.adapter as unknown as DrizzleAdapter;
      expect(await adapter.tableExists("dc_articles")).toBe(false);
      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as { collections: { slug: string }[] };
      expect(definition.collections).toEqual([]);
      const repo = new SchemaEventsRepository(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect
      );
      expect(
        (await repo.listFileApplies())
          .filter(row => row.status === "applied")
          .map(row => row.filename)
          .sort()
      ).toEqual(files);
    });

    // Windows ignores the mode and root writes past it, so neither can make the folder unwritable.
    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "leaves the collection whole when its delete's migration cannot be written",
      async () => {
        vi.stubEnv("NODE_ENV", "development");
        const service = t.getService("collectionService");
        await service.createCollection(created("articles"), {});
        const folder = join(t.basePath, "database", "history");
        const definitionPath = join(t.basePath, "schema", "builder.json");
        const before = {
          files: readdirSync(folder).sort(),
          definition: readFileSync(definitionPath, "utf-8"),
        };

        chmodSync(folder, 0o555);
        try {
          await expect(
            service.deleteCollection("articles", {})
          ).rejects.toBeDefined();
        } finally {
          chmodSync(folder, 0o755);
        }

        // Nothing was torn down: the table, its registry row (read from the table, not a cache),
        // the definition and the folder stand.
        const adapter = t.adapter as unknown as DrizzleAdapter;
        expect(await adapter.tableExists("dc_articles")).toBe(true);
        const rows = (await adapter.executeQuery(
          "SELECT slug FROM dynamic_collections WHERE slug = 'articles'"
        )) as unknown as { slug: string }[];
        expect(rows.map(row => row.slug)).toEqual(["articles"]);
        expect({
          files: readdirSync(folder).sort(),
          definition: readFileSync(definitionPath, "utf-8"),
        }).toEqual(before);
      }
    );

    it("refuses a delete the history checks refuse, before anything is torn down", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});
      const folder = join(t.basePath, "database", "history");
      const [first] = readdirSync(folder).filter(f => f.endsWith(".sql"));
      writeFileSync(
        join(folder, first!),
        `${readFileSync(join(folder, first!), "utf-8")}\n-- edited\n`
      );

      await expect(
        service.deleteCollection("articles", {})
      ).rejects.toMatchObject({ statusCode: 409 });

      const adapter = t.adapter as unknown as DrizzleAdapter;
      expect(await adapter.tableExists("dc_articles")).toBe(true);
      await expect(
        service.getCollection("articles", {})
      ).resolves.toBeDefined();
    });

    it("writes a plugin's long text and formatted number through the writer", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      const fields = [
        { name: "bio", type: "text", options: { variant: "long" } },
        { name: "price", type: "number", options: { format: "float" } },
      ];

      await service.createCollection(
        { name: "profiles", label: "Profile", fields } as Parameters<
          CollectionService["createCollection"]
        >[0],
        {}
      );

      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as { collections: { slug: string; fields: unknown[] }[] };
      expect(
        definition.collections.find(c => c.slug === "profiles")?.fields
      ).toEqual(fields);
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const live = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect,
        ["dc_profiles"]
      );
      const columns = new Map(
        live.tables[0]?.columns.map(c => [c.name, c.type.toLowerCase()])
      );
      // A long text is unbounded and a float is not an integer, on every dialect.
      expect(columns.get("bio")).toMatch(/text/);
      expect(columns.get("price")).not.toMatch(/int/);
    });

    /** The Builder's field change, as the admin applies it. */
    const applyFields = (
      collectionName: string,
      fields: unknown[],
      extra: Record<string, unknown> = {}
    ) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName },
        { fields, confirmed: true, schemaVersion: 1, ...extra }
      );

    it("writes a field change, with the person's rename, as its own applied file", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await adapter.executeQuery(
        "INSERT INTO dc_articles (id, title, body, slug, created_at, updated_at) VALUES ('a', 'T', 'kept', 'a', '2026-11-06 00:00:00', '2026-11-06 00:00:00')"
      );

      await applyFields(
        "articles",
        [
          { name: "content", type: "text" },
          { name: "subtitle", type: "text" },
        ],
        {
          renameResolutions: [
            {
              tableName: "dc_articles",
              fromColumn: "body",
              toColumn: "content",
              choice: "rename",
            },
          ],
        }
      );

      const folder = join(t.basePath, "database", "history");
      const files = readdirSync(folder)
        .filter(f => f.endsWith(".sql"))
        .sort();
      expect(files.map(f => f.replace(/^\d{8}_\d{6}_\d{3}_/, ""))).toEqual([
        "articles_create.sql",
        "articles_update.sql",
      ]);
      expect(readFileSync(join(folder, files[1]!), "utf-8")).toMatch(
        /RENAME COLUMN/
      );
      const rows = (await adapter.executeQuery(
        "SELECT content FROM dc_articles"
      )) as unknown as { content: string }[];
      expect(JSON.stringify(rows)).toContain("kept");
      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as { collections: { slug: string; fields: { name: string }[] }[] };
      expect(
        definition.collections
          .find(c => c.slug === "articles")
          ?.fields.map(f => f.name)
      ).toEqual(["content", "subtitle"]);
    });

    it("previews a field change with the lines the review shows, and writes nothing", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await adapter.executeQuery(
        "INSERT INTO dc_articles (id, title, body, slug, created_at, updated_at) VALUES ('a', 'T', 'x', 'a', '2026-11-06 00:00:00', '2026-11-06 00:00:00')"
      );
      const folder = join(t.basePath, "database", "history");
      const before = readdirSync(folder).sort();

      const response = (await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "articles" },
        {
          fields: [
            { name: "body", type: "text" },
            { name: "subtitle", type: "text", required: true },
          ],
          eventResolutions: [
            {
              kind: "provide_default",
              eventId: "add_required_field_no_default:dc_articles.subtitle",
              value: "Untitled",
            },
          ],
        }
      )) as Response;

      const body = (await response.json()) as { notices?: string[] };
      expect(body.notices).toEqual([
        "This save fills 1 row with 'Untitled' in subtitle.",
      ]);
      expect(readdirSync(folder).sort()).toEqual(before);
    });

    /** `articles` with one row, which a field made required does not fit. */
    const articlesWithARow = async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await adapter.executeQuery(
        "INSERT INTO dc_articles (id, title, body, slug, created_at, updated_at) VALUES ('a', 'T', 'x', 'a', '2026-11-06 00:00:00', '2026-11-06 00:00:00')"
      );
      return adapter;
    };

    it("refuses an answer this save does not ask, and writes nothing", async () => {
      const adapter = await articlesWithARow();
      const folder = join(t.basePath, "database", "history");
      const before = readdirSync(folder).sort();

      // A delete of the rows of a field the save leaves optional.
      await expect(
        applyFields("articles", [{ name: "body", type: "text" }], {
          eventResolutions: [
            {
              kind: "delete_nonconforming",
              eventId: "add_not_null_with_nulls:dc_articles.body",
            },
          ],
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      // An answer naming another collection's table.
      await expect(
        applyFields(
          "articles",
          [
            { name: "body", type: "text" },
            { name: "subtitle", type: "text", required: true },
          ],
          {
            eventResolutions: [
              {
                kind: "provide_default",
                eventId: "add_required_field_no_default:dc_people.subtitle",
                value: "x",
              },
            ],
          }
        )
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      expect(readdirSync(folder).sort()).toEqual(before);
      const rows = (await adapter.executeQuery(
        "SELECT id FROM dc_articles"
      )) as unknown as { id: string }[];
      expect(rows).toHaveLength(1);
    });

    it("fills a JSON field made required with a structured value", async () => {
      const adapter = await articlesWithARow();

      await applyFields(
        "articles",
        [
          { name: "body", type: "text" },
          { name: "meta", type: "json", required: true },
        ],
        {
          eventResolutions: [
            {
              kind: "provide_default",
              eventId: "add_required_field_no_default:dc_articles.meta",
              value: { tags: ["a"], n: 1 },
            },
          ],
        }
      );

      const rows = (await adapter.executeQuery(
        "SELECT meta FROM dc_articles"
      )) as unknown as { meta: unknown }[];
      const stored = rows[0]?.meta;
      expect(typeof stored === "string" ? JSON.parse(stored) : stored).toEqual({
        tags: ["a"],
        n: 1,
      });
    });

    it("keeps a decimal field's storage through the definition, so the next save changes no column", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      const price = {
        name: "price",
        type: "number",
        dbType: "decimal",
        precision: 10,
        scale: 2,
      };
      await service.createCollection(
        { name: "products", label: "Product", fields: [price] } as Parameters<
          CollectionService["createCollection"]
        >[0],
        {}
      );

      await service.updateCollection(
        "products",
        { label: "Item" } as Parameters<
          CollectionService["updateCollection"]
        >[1],
        {}
      );

      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as { collections: { slug: string; fields: unknown[] }[] };
      expect(
        definition.collections.find(c => c.slug === "products")?.fields
      ).toEqual([price]);
      const folder = join(t.basePath, "database", "history");
      const files = readdirSync(folder)
        .filter(f => f.endsWith(".sql"))
        .sort();
      expect(files).toHaveLength(2);
      // The update's file writes the registry row, whose fields name `price`, and changes no
      // column: a definition that lost the storage keys would retype it here.
      expect(readFileSync(join(folder, files[1]!), "utf-8")).not.toMatch(
        /ALTER TABLE\s+[`"]?dc_products/i
      );
    });

    it.runIf(dialect !== "sqlite")(
      "keys a relationship to the table a renamed target collection kept",
      async () => {
        vi.stubEnv("NODE_ENV", "development");
        const service = t.getService("collectionService");
        await service.createCollection(created("people"), {});
        // The collection's slug renamed, its table kept: `writers` is stored in `dc_people`.
        const adapter = t.adapter as unknown as DrizzleAdapter;
        await adapter.executeQuery(
          "UPDATE dynamic_collections SET slug = 'writers' WHERE slug = 'people'"
        );

        await service.createCollection(
          {
            name: "notes",
            label: "Note",
            fields: [
              {
                name: "author",
                type: "relationship",
                options: {
                  target: "writers",
                  relationType: "manyToOne",
                  onDelete: "set null",
                },
              },
            ],
          } as Parameters<CollectionService["createCollection"]>[0],
          {}
        );

        const live = await introspectLiveSnapshot(
          adapter.getDrizzle(),
          adapter.getCapabilities().dialect,
          ["dc_notes"]
        );
        expect(
          live.tables[0]?.foreignKeys?.map(fk => fk.referencesTable)
        ).toEqual(["dc_people"]);
        const folder = join(t.basePath, "database", "history");
        const notes = readdirSync(folder).find(f =>
          f.endsWith("_notes_create.sql")
        );
        expect(readFileSync(join(folder, notes!), "utf-8")).not.toMatch(
          /dc_writers/
        );
      }
    );

    it.runIf(dialect !== "sqlite")(
      "changes a relationship's foreign-key action when its onDelete changes",
      async () => {
        vi.stubEnv("NODE_ENV", "development");
        const service = t.getService("collectionService");
        await service.createCollection(created("people"), {});
        const author = (onDelete: string) => ({
          name: "author",
          type: "relationship",
          options: { target: "people", relationType: "manyToOne", onDelete },
        });
        await service.createCollection(
          {
            name: "notes",
            label: "Note",
            fields: [author("set null")],
          } as Parameters<CollectionService["createCollection"]>[0],
          {}
        );

        await applyFields("notes", [author("cascade")]);

        const adapter = t.adapter as unknown as DrizzleAdapter;
        const live = await introspectLiveSnapshot(
          adapter.getDrizzle(),
          adapter.getCapabilities().dialect,
          ["dc_notes"]
        );
        expect(
          live.tables[0]?.foreignKeys?.find(
            fk => fk.referencesTable === "dc_people"
          )?.onDelete
        ).toBe("cascade");
      }
    );

    it("writes a plugin's update as an applied migration once its push has run", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});

      await service.updateCollection(
        "articles",
        {
          fields: [
            { name: "body", type: "text" },
            { name: "rating", type: "number" },
          ],
        } as Parameters<CollectionService["updateCollection"]>[1],
        {}
      );
      await service.updateCollection(
        "articles",
        { label: "Story" } as Parameters<
          CollectionService["updateCollection"]
        >[1],
        {}
      );

      const folder = join(t.basePath, "database", "history");
      const files = readdirSync(folder)
        .filter(f => f.endsWith(".sql"))
        .sort();
      expect(files.map(f => f.replace(/^\d{8}_\d{6}_\d{3}_/, ""))).toEqual([
        "articles_create.sql",
        "articles_update.sql",
        "articles_update.sql",
      ]);
      expect(existsSync(join(t.basePath, "src", "db", "migrations"))).toBe(
        false
      );
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const live = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect,
        ["dc_articles"]
      );
      expect(live.tables[0]?.columns.map(c => c.name)).toContain("rating");
      const repo = new SchemaEventsRepository(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect
      );
      expect(
        (await repo.listFileApplies())
          .filter(row => row.status === "applied")
          .map(row => row.filename)
          .sort()
      ).toEqual(files);
    });

    /** The newest update file `updateCollection` wrote for `articles`, as a deploy replays it. */
    const latestUpdateFile = () => {
      const folder = join(t.basePath, "database", "history");
      const updates = readdirSync(folder)
        .filter(f => f.endsWith("_articles_update.sql"))
        .sort();
      return readFileSync(join(folder, updates[updates.length - 1]!), "utf-8");
    };

    it("writes a plugin's rename of a field as a rename, so a deploy keeps its values", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});

      await service.updateCollection(
        "articles",
        { fields: [{ name: "content", type: "text" }] } as Parameters<
          CollectionService["updateCollection"]
        >[1],
        {}
      );

      const file = latestUpdateFile();
      expect(file).toMatch(/RENAME COLUMN/i);
      expect(file).not.toMatch(/DROP COLUMN/i);
    });

    it("writes the fill a plugin's required field gives existing rows, so a deploy can make it required", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await adapter.executeQuery(
        "INSERT INTO dc_articles (id, title, body, slug, created_at, updated_at) VALUES ('a', 'T', 'x', 'a', '2026-11-06 00:00:00', '2026-11-06 00:00:00')"
      );

      await service.updateCollection(
        "articles",
        {
          fields: [
            { name: "body", type: "text" },
            { name: "rating", type: "number", required: true },
          ],
        } as Parameters<CollectionService["updateCollection"]>[1],
        {}
      );

      expect(latestUpdateFile()).toMatch(
        /UPDATE[^;]*rating[^;]*WHERE[^;]*rating[^;]*IS NULL/i
      );
    });

    it("writes a field named with capitals under its own name, its column in snake case", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");

      await service.createCollection(
        {
          name: "people",
          label: "Person",
          fields: [{ name: "firstName", type: "text" }],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );

      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as { collections: { slug: string; fields: { name: string }[] }[] };
      expect(
        definition.collections.find(c => c.slug === "people")?.fields[0]?.name
      ).toBe("firstName");
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const live = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect,
        ["dc_people"]
      );
      expect(live.tables[0]?.columns.map(c => c.name)).toContain("first_name");
    });

    it("changes a field's type through the Builder, and a replay ends with the same table", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(created("articles"), {});

      await applyFields("articles", [{ name: "body", type: "number" }]);

      const adapter = t.adapter as unknown as DrizzleAdapter;
      const columnsOf = async (on: DrizzleAdapter) =>
        (
          await introspectLiveSnapshot(
            on.getDrizzle(),
            on.getCapabilities().dialect,
            ["dc_articles"]
          )
        ).tables[0]?.columns.map(c => `${c.name}:${c.type.toLowerCase()}`);
      const here = await columnsOf(adapter);
      expect(here?.find(c => c.startsWith("body:"))).not.toMatch(/text|char/);

      const folder = await mkdtemp(join(tmpdir(), "nextly-type-replay-"));
      try {
        await cp(join(t.basePath, "database", "history"), folder, {
          recursive: true,
        });
        await t.destroy();
        instance = await createTestNextly({ dialect });
        const fresh = instance.adapter as unknown as DrizzleAdapter;
        await runFileMigrations({
          adapter: fresh as never,
          db: fresh.getDrizzle(),
          dialect: fresh.getCapabilities().dialect,
          migrationsDir: folder,
          logger: createLogger({ quiet: true }),
        });
        expect(await columnsOf(fresh)).toEqual(here);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("outside development writes them and runs nothing", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const service = t.getService("collectionService");

      await service.createCollection(created("articles"), {});

      const folder = join(t.basePath, "database", "history");
      expect(readdirSync(folder).filter(f => f.endsWith(".sql"))).toHaveLength(
        1
      );
      const adapter = t.adapter as unknown as DrizzleAdapter;
      expect(await adapter.tableExists("dc_articles")).toBe(false);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a field-group field renamed through updateCollection (%s)",
  dialect => {
    it("moves the group's rows to the new name in the update's file, so a deploy keeps them", async () => {
      const t = await createTestNextly({
        dialect,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
        fieldGroups: [
          defineFieldGroup({
            slug: "svc_meta",
            fields: [text({ name: "note" })],
          }),
        ],
      });
      instance = t;
      vi.stubEnv("NODE_ENV", "development");
      const service = t.getService("collectionService");
      await service.createCollection(
        {
          name: "articles",
          label: "Article",
          fields: [{ name: "hero", type: "component", component: "svc_meta" }],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );

      await service.updateCollection(
        "articles",
        {
          fields: [
            { name: "banner", type: "component", component: "svc_meta" },
          ],
        } as Parameters<CollectionService["updateCollection"]>[1],
        {}
      );

      const folder = join(t.basePath, "database", "history");
      const update = readdirSync(folder)
        .filter(f => f.endsWith("_articles_update.sql"))
        .sort()
        .pop();
      expect(readFileSync(join(folder, update!), "utf-8")).toMatch(
        /UPDATE[^;]*_parent_field[^;]*'banner'[^;]*'hero'/
      );
    });
  }
);
