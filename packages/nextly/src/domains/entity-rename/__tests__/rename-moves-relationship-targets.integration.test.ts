/**
 * A renamed collection takes the relationships that point at it with it. A Builder-made
 * collection, Single or field group keeps each relationship's target as a slug in its stored
 * fields, and a rename keeps every table name, so a relationship resolves once its stored target
 * names the new slug. The rename rewrites those targets in its own transaction, nested ones
 * included, and refuses what it cannot move: a polymorphic field listing the collection (its
 * stored values name the slug), a field an entity's code defines (code is not rewritten at
 * runtime), and a field that already names the new slug (it would quietly start resolving).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  seedBuilderCollection,
  seedBuilderComponent,
  seedBuilderSingle,
} from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { FieldConfig } from "../../../collections/fields/types";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { MIGRATION_TARGET } from "../../field-groups/migration/target";
import { calculateSchemaHash } from "../../schema/services/schema-hash";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

function t(): TestNextly {
  if (!handle) throw new Error("no test instance");
  return handle;
}

type Seeded = Parameters<typeof seedBuilderCollection>[1]["fields"];

/**
 * `authors` with one author, `posts` relating to it at the top level (the Builder shape) and
 * inside a group, a Single and a field group relating to it, and `extra` fields on `posts` for the
 * refusal cases. All in one boot: a re-boot on a server dialect drops the database the first
 * provisioned.
 */
async function seed(dialect: TestDialect, extra: Seeded = []): Promise<void> {
  handle = await createTestNextly({ dialect });
  const adapter = handle.adapter;
  await seedBuilderCollection(adapter, {
    slug: "authors",
    fields: [{ name: "name", type: "text" }],
  });
  await seedBuilderCollection(adapter, {
    slug: "posts",
    fields: [
      { name: "title", type: "text" },
      {
        name: "writer",
        type: "relationship",
        options: { relationType: "manyToOne", target: "authors" },
      },
      {
        name: "meta",
        type: "group",
        fields: [
          { name: "editor", type: "relationship", relationTo: "authors" },
        ],
      },
      ...extra,
    ],
  });
  await seedBuilderSingle(adapter, {
    slug: "homepage",
    fields: [{ name: "featured", type: "relationship", relationTo: "authors" }],
  });
  await seedBuilderComponent(adapter, {
    slug: "byline",
    fields: [{ name: "person", type: "relationship", relationTo: "authors" }],
  });
  // The collection service's factory registers the services the handler reads through.
  handle.getService("collectionService");
  const now = Math.floor(Date.now() / 1000);
  const stamp = dialect === "sqlite" ? `${now}` : "CURRENT_TIMESTAMP";
  await adapter.executeQuery(
    `INSERT INTO dc_authors (id, title, slug, name, created_at, updated_at) VALUES ('author-1', 'Ada', 'ada', 'Ada', ${stamp}, ${stamp})`
  );
}

function rename(from: string, to: string) {
  return new DynamicCollectionRegistryService(
    t().adapter,
    silentLogger
  ).updateCollectionMetadata(from, { slug: to });
}

/** A registry row's stored fields and schema hash, by its slug. */
async function stored(
  table: string,
  slug: string
): Promise<{ fields: Array<Record<string, unknown>>; schemaHash: string }> {
  const [row] =
    // Keyed by the tables' property names, as the adapter returns a row.
    (
      await t().adapter.select<{
        slug: string;
        fields: unknown;
        schemaHash: string;
      }>(table, { columns: ["slug", "fields", "schemaHash"] })
    ).filter(entry => entry.slug === slug);
  if (!row) throw new Error(`no ${slug} in ${table}`);
  const fields: unknown =
    typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields;
  return {
    fields: fields as Array<Record<string, unknown>>,
    schemaHash: row.schemaHash,
  };
}

function field(
  fields: Array<Record<string, unknown>>,
  name: string
): Record<string, unknown> {
  const found = fields.find(candidate => candidate.name === name);
  if (!found) throw new Error(`no field ${name}`);
  return found;
}

/** The registry's collection slugs. */
async function slugs(): Promise<string[]> {
  return (await t().adapter.select<{ slug: string }>("dynamic_collections"))
    .map(row => row.slug)
    .sort();
}

describe.each(getConfiguredTestDialects())(
  "a rename and the relationships that point at the collection (integration, %s)",
  dialect => {
    it("moves every stored target to the new slug, nested ones and other entities' included, and the relationship still resolves", async () => {
      await seed(dialect);

      await rename("authors", "writers");

      const posts = await stored("dynamic_collections", "posts");
      expect(field(posts.fields, "writer").options).toMatchObject({
        target: "writers",
      });
      const meta = field(posts.fields, "meta").fields as Array<
        Record<string, unknown>
      >;
      expect(field(meta, "editor").relationTo).toBe("writers");
      expect(
        field((await stored("dynamic_singles", "homepage")).fields, "featured")
          .relationTo
      ).toBe("writers");
      expect(
        field((await stored("dynamic_components", "byline")).fields, "person")
          .relationTo
      ).toBe("writers");
      // The stored hash describes the stored fields, so no change reads as pending.
      expect(posts.schemaHash).toBe(
        calculateSchemaHash(posts.fields as unknown as FieldConfig[])
      );

      // Written and read through the relationship under the new slug.
      const handler = t().getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "Hello", writer: "author-1" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no post id");
      const read = await handler.getEntry({
        collectionName: "posts",
        entryId: id,
        depth: 1,
        overrideAccess: true,
      });
      expect(
        (read.data as { writer?: unknown } | undefined)?.writer
      ).toMatchObject({ id: "author-1", name: "Ada" });
    });

    it("moves a field group's targets where its registry's storage was migrated to its new name", async () => {
      await seed(dialect);
      // The field-group storage migration renames the registry; the registry's own resolver reads
      // it under either name, and so does the rename.
      await t().adapter.executeQuery(
        `ALTER TABLE dynamic_components RENAME TO ${MIGRATION_TARGET.registryTable}`
      );

      await rename("authors", "writers");

      expect(
        field(
          (await stored(MIGRATION_TARGET.registryTable, "byline")).fields,
          "person"
        ).relationTo
      ).toBe("writers");
    });

    it("refuses while a polymorphic field lists the collection, naming it, and renames nothing", async () => {
      await seed(dialect, [
        {
          name: "either",
          type: "relationship",
          relationTo: ["authors", "posts"],
        },
      ]);

      await expect(rename("authors", "writers")).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("posts.either"),
      });
      expect(await slugs()).toEqual(["authors", "posts"]);
      expect(
        field((await stored("dynamic_collections", "posts")).fields, "writer")
          .options
      ).toMatchObject({ target: "authors" });
    });

    it("refuses while a field an entity's code defines targets the collection, naming it", async () => {
      await seed(dialect);
      // The posts collection now comes from code: its stored fields are its config's, which a
      // rename cannot change.
      await t().adapter.update(
        "dynamic_collections",
        { source: "code" },
        { and: [{ column: "slug", op: "=", value: "posts" }] }
      );

      await expect(rename("authors", "writers")).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("posts.writer"),
      });
      expect(await slugs()).toEqual(["authors", "posts"]);
    });

    it("refuses a new slug a stored field already targets, naming it", async () => {
      await seed(dialect, [
        { name: "ghost", type: "relationship", relationTo: "writers" },
      ]);

      await expect(rename("authors", "writers")).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("posts.ghost"),
      });
      expect(await slugs()).toEqual(["authors", "posts"]);
    });
  }
);
