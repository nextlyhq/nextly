/**
 * A collection on either side of a many-to-many relationship is not renamed.
 *
 * Its links live in a junction table whose name and columns are spelled from
 * both collections' slugs (`dc_<a>_dc_<b>_<field>`, `<a>_id`, `<b>_id`), and
 * a rename keeps every physical name. After a rename the relationship would
 * look for a junction under the new slug, find none, and read the links as
 * empty. So the rename is refused, naming the fields, and the links stay
 * readable. A collection with no many-to-many on either side still renames.
 *
 * The collections are Builder-authored, because only the Schema Builder can
 * declare a many-to-many field, and only a Builder entity can be renamed.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { clearServices } from "../../../di/register";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";

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

/**
 * `tags`, `posts` with a many-to-many to `tags`, and `notes` with neither,
 * seeded through the Builder path so the real junction table exists; then a
 * reboot on the same database, so the relationship service is reachable, and
 * one link written through it.
 */
async function seed(dialect: TestDialect): Promise<void> {
  handle = await createTestNextly({ dialect });
  const adapter = handle.adapter;
  await seedBuilderCollection(adapter, {
    slug: "tags",
    fields: [{ name: "name", type: "text" }],
  });
  await seedBuilderCollection(adapter, {
    slug: "posts",
    fields: [
      { name: "title", type: "text" },
      {
        name: "tags",
        type: "relationship",
        options: { relationType: "manyToMany", target: "tags" },
      },
    ],
  });
  await seedBuilderCollection(adapter, {
    slug: "notes",
    fields: [{ name: "body", type: "text" }],
  });
  clearServices();
  handle = await createTestNextly({ dialect, adapter });
  handle.getService("collectionService");
  const now = Math.floor(Date.now() / 1000);
  const stamp = dialect === "sqlite" ? `${now}` : "CURRENT_TIMESTAMP";
  await adapter.executeQuery(
    `INSERT INTO dc_tags (id, title, slug, name, created_at, updated_at) VALUES ('tag-1', 'JavaScript', 'javascript', 'javascript', ${stamp}, ${stamp})`
  );
  await adapter.executeQuery(
    `INSERT INTO dc_posts (id, title, slug, created_at, updated_at) VALUES ('post-1', 'Hello', 'hello', ${stamp}, ${stamp})`
  );
  await t()
    .getService("relationshipService")
    .insertManyToManyRelations("posts", "post-1", await storedField("posts"), [
      "tag-1",
    ]);
}

/** The many-to-many field as the registry stores it on `slug`. */
async function storedField(slug: string): Promise<FieldDefinition> {
  const [row] = (
    await t().adapter.select<{ slug: string; fields: unknown }>(
      "dynamic_collections"
    )
  ).filter(entry => entry.slug === slug);
  const fields: unknown =
    typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields;
  const field = (fields as FieldDefinition[]).find(
    candidate => candidate.name === "tags"
  );
  if (!field) throw new Error(`no tags field on ${slug}`);
  return field;
}

function rename(from: string, to: string) {
  return new DynamicCollectionRegistryService(
    t().adapter,
    silentLogger
  ).updateCollectionMetadata(from, { slug: to });
}

/** The registry's collection slugs. */
async function slugs(): Promise<string[]> {
  return (await t().adapter.select<{ slug: string }>("dynamic_collections"))
    .map(row => row.slug)
    .sort();
}

/** The tags `posts`' first entry links to, read through the relationship. */
async function linkedTags(): Promise<string[]> {
  const read = await t()
    .getService("relationshipService")
    .batchFetchManyToManyRelations(
      "posts",
      ["post-1"],
      await storedField("posts")
    );
  return (read.get("post-1") ?? []).map(tag => String(tag.id));
}

describe.each(getConfiguredTestDialects())(
  "a rename and many-to-many relationships (integration, %s)",
  dialect => {
    it("refuses to rename the collection a many-to-many field belongs to, naming it, and keeps its links", async () => {
      await seed(dialect);
      const before = await slugs();

      await expect(rename("posts", "articles")).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("posts.tags"),
      });

      expect(await slugs()).toEqual(before);
      expect(await linkedTags()).toEqual(["tag-1"]);
    }, 120_000);

    it("refuses to rename the collection a many-to-many field points at, naming the field, and keeps its links", async () => {
      await seed(dialect);
      const before = await slugs();

      await expect(rename("tags", "labels")).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("posts.tags"),
      });

      expect(await slugs()).toEqual(before);
      expect(await linkedTags()).toEqual(["tag-1"]);
    }, 120_000);

    it("renames a collection with no many-to-many on either side", async () => {
      await seed(dialect);

      await rename("notes", "journal");

      expect(await slugs()).toContain("journal");
      expect(await slugs()).not.toContain("notes");
      expect(await linkedTags()).toEqual(["tag-1"]);
    }, 120_000);
  }
);
