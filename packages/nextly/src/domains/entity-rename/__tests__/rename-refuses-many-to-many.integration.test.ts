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
 *
 * A rename also holds the schema lock, as every other schema change does: one
 * started while a migration holds it is refused at once, with nothing written,
 * and a refused rename leaves the lock free for the next change.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { withSchemaLock } from "../../schema/pipeline/schema-lock";
import { renameEntity } from "../rename-entity";

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
 * seeded through the Builder path so the real junction table exists, and one
 * link written through the relationship service. All in one boot: a re-boot
 * on a server dialect drops the database the first boot provisioned.
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
  // The collection service's factory registers the relationship service, so
  // it is resolved first, after the seed, for the relationship service to be
  // reachable below.
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

/**
 * Take the schema lock as `nextly migrate` does and hold it until the returned
 * function is called, which releases it and waits for the holder to finish.
 * The rename under test runs outside the holder's async context, so it is a
 * second contender rather than work inside the holder.
 */
async function holdSchemaLock(): Promise<() => Promise<void>> {
  let release = (): void => undefined;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let held = (): void => undefined;
  const isHeld = new Promise<void>(resolve => {
    held = resolve;
  });
  const holder = withSchemaLock(
    {
      adapter: t().adapter,
      command: "nextly migrate",
      whenHeld: "refuse",
      mayCreateTables: true,
      releaseOnInterrupt: false,
    },
    async () => {
      held();
      await released;
    }
  );
  await Promise.race([isHeld, holder]);
  return async () => {
    release();
    await holder;
  };
}

/** A migration taking the schema lock now, refused at once if it is held. */
function migrationTakesTheLock() {
  return withSchemaLock(
    {
      adapter: t().adapter,
      command: "nextly migrate",
      whenHeld: "refuse",
      mayCreateTables: true,
      releaseOnInterrupt: false,
    },
    () => Promise.resolve("ran")
  );
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

    it("refuses before the registry row is written", async () => {
      await seed(dialect);
      // Answers as a write that moved the row would, without moving it: the
      // refusal must not depend on what the write leaves behind.
      const writeRegistry = vi.fn(async () => ({}));

      await expect(
        renameEntity(t().adapter, {
          dialect,
          move: { kind: "collection", from: "posts", to: "articles" },
          writeRegistry,
          logger: silentLogger,
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("posts.tags"),
      });

      expect(writeRegistry).not.toHaveBeenCalled();
    }, 120_000);

    it("refuses a rename at once, writing nothing, while a migration holds the schema lock", async () => {
      await seed(dialect);
      const before = await slugs();
      const releaseLock = await holdSchemaLock();
      try {
        await expect(rename("notes", "journal")).rejects.toMatchObject({
          code: "SERVICE_UNAVAILABLE",
          publicMessage:
            "A migration is running on this database, so this change was not saved. " +
            "Save it again once the migration ends.",
        });
      } finally {
        await releaseLock();
      }

      expect(await slugs()).toEqual(before);
    }, 120_000);

    it("leaves the schema lock free after a refused rename, for the next change to take", async () => {
      await seed(dialect);

      await expect(rename("posts", "articles")).rejects.toMatchObject({
        code: "CONFLICT",
      });

      await expect(migrationTakesTheLock()).resolves.toEqual({
        ran: true,
        value: "ran",
      });
      await rename("notes", "journal");
      expect(await slugs()).toContain("journal");
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
