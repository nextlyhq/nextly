/**
 * A component's many-to-many reads back as the list of ids it was saved with, on every dialect.
 *
 * A component has no junction table, so a many-to-many on one keeps its ids on the component's own
 * row. The write path keeps the value an array (`normalizeRelationshipField` reads
 * `relationType: "manyToMany"` as many-valued), so the column has to store a list and the read has
 * to decode one. A column the read path does not decode hands back whatever the driver made of the
 * array: on PostgreSQL a `text` column receives an array literal and returns it as a string.
 *
 * Built through the Builder seeding recipe (the creating SQL, then the registry), as a Builder
 * component is in production, and read back through the Single that embeds it. Seeded on the
 * booted instance rather than across a reboot: a reboot releases the database a non-SQLite boot
 * provisioned, and the Single service resolves the seeded entities from the registry live.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  seedBuilderComponent,
  seedBuilderSingle,
} from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const tags = defineCollection({
  slug: "tags",
  fields: [text({ name: "name" })],
});

/**
 * Seed a `hero` component with a many-to-many to `tags`, and a Single embedding it, then reboot on
 * the same adapter so the registry resolves both.
 */
async function bootWithHero(dialect: TestDialect): Promise<TestNextly> {
  const dialectOption = dialect === "sqlite" ? {} : { dialect };
  handle = await createTestNextly({ ...dialectOption, collections: [tags] });
  const adapter = handle.adapter;

  await seedBuilderComponent(adapter, {
    slug: "hero",
    fields: [
      { name: "heading", type: "text" },
      {
        name: "related",
        type: "relationship",
        options: { relationType: "manyToMany", target: "tags" },
      },
    ],
  });
  await seedBuilderSingle(adapter, {
    slug: "preferences",
    fields: [{ name: "seo", type: "component", component: "hero" }],
  });

  return handle;
}

describe.each(getConfiguredTestDialects())(
  "a component's many-to-many on %s",
  (dialect: TestDialect) => {
    it("reads back as the list of ids it was saved with", async () => {
      const t = await bootWithHero(dialect);
      const first = await t.nextly.create({
        collection: "tags",
        data: { name: "first" },
      });
      const second = await t.nextly.create({
        collection: "tags",
        data: { name: "second" },
      });
      const ids = [String(first.item.id), String(second.item.id)];

      const singles = t.getService("singleEntryService") as SingleEntryService;
      const saved = await singles.update(
        "preferences",
        { seo: { heading: "Hello", related: ids } },
        { overrideAccess: true }
      );
      // The message is asserted with the flag so a refused save names its reason.
      expect({ success: saved.success, message: saved.message }).toEqual({
        success: true,
        message: undefined,
      });

      const read = await singles.get("preferences", {
        depth: 0,
        overrideAccess: true,
      });
      expect(read.success).toBe(true);
      const seo = (read.data as { seo?: { related?: unknown } }).seo;
      expect(seo?.related).toEqual(ids);
    });

    // The default read expands relationships. A component has no junction table, so the related
    // entries are found from the ids on its row, not from a junction query that finds none.
    it("expands into the related entries at the default depth", async () => {
      const t = await bootWithHero(dialect);
      const first = await t.nextly.create({
        collection: "tags",
        data: { name: "first" },
      });
      const second = await t.nextly.create({
        collection: "tags",
        data: { name: "second" },
      });
      const ids = [String(first.item.id), String(second.item.id)];

      const singles = t.getService("singleEntryService") as SingleEntryService;
      const saved = await singles.update(
        "preferences",
        { seo: { heading: "Hello", related: ids } },
        { overrideAccess: true }
      );
      expect(saved.success).toBe(true);

      const read = await singles.get("preferences", { overrideAccess: true });
      const seo = (read.data as { seo?: { related?: unknown } }).seo;
      const related = seo?.related as { id?: unknown; name?: unknown }[];
      expect(related.map(entry => [String(entry.id), entry.name])).toEqual([
        [ids[0], "first"],
        [ids[1], "second"],
      ]);
    });

    // A single id is one reference, and a many-to-many reads as a list whatever it holds: a row
    // written with one id, or an older row holding a bare id in a column SQLite never retypes.
    it("reads a single saved id back as a one-item list", async () => {
      const t = await bootWithHero(dialect);
      const tag = await t.nextly.create({
        collection: "tags",
        data: { name: "only" },
      });
      const id = String(tag.item.id);

      const singles = t.getService("singleEntryService") as SingleEntryService;
      const saved = await singles.update(
        "preferences",
        { seo: { heading: "Hello", related: id } },
        { overrideAccess: true }
      );
      expect(saved.success).toBe(true);

      const read = await singles.get("preferences", {
        depth: 0,
        overrideAccess: true,
      });
      const seo = (read.data as { seo?: { related?: unknown } }).seo;
      expect(seo?.related).toEqual([id]);
    });
  }
);
