/**
 * `contains` finds the entries whose hasMany relationship holds an id, on PostgreSQL, MySQL and
 * SQLite: the filter the blog template's category and tag pages list their posts with.
 *
 * A hasMany relationship is stored as a JSON array of ids, in a `jsonb` column on PostgreSQL. The
 * case-insensitive match `contains` compiles to lowers the column, and PostgreSQL has no
 * `lower()` for `jsonb`, so there the filter failed ("function lower(jsonb) does not exist")
 * while MySQL and SQLite searched the serialized array. Now all three match the serialized text.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

describeEachDialect("contains on a hasMany relationship", dialect => {
  let current: TestNextly;
  let travel: string;
  let food: string;

  beforeEach(async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: "topics",
          fields: [text({ name: "name" })],
        }),
        defineCollection({
          slug: "articles",
          fields: [
            text({ name: "title" }),
            relationship({
              name: "topics",
              relationTo: "topics",
              hasMany: true,
            }),
          ],
        }),
      ],
    });
    const topic = async (name: string): Promise<string> => {
      const created = await current.nextly.create({
        collection: "topics",
        data: { name },
        overrideAccess: true,
      });
      return String(created.item.id);
    };
    travel = await topic("Travel");
    food = await topic("Food");
    for (const [title, topics] of [
      ["Lisbon", [travel]],
      ["Street food in Hanoi", [travel, food]],
      ["Sourdough", [food]],
      ["No topic", []],
    ] as const) {
      await current.nextly.create({
        collection: "articles",
        data: { title, topics: [...topics] },
        overrideAccess: true,
      });
    }
  });

  afterEach(async () => {
    await current.destroy();
  });

  async function titlesWithTopic(id: string): Promise<string[]> {
    const found = await current.nextly.find({
      collection: "articles",
      where: { topics: { contains: id } },
      overrideAccess: true,
    });
    return found.items.map(item => String(item.title)).sort();
  }

  it("finds each entry whose relationship holds the id, and no other", async () => {
    expect(await titlesWithTopic(travel)).toEqual(
      ["Lisbon", "Street food in Hanoi"].sort()
    );
    expect(await titlesWithTopic(food)).toEqual(
      ["Sourdough", "Street food in Hanoi"].sort()
    );
  });
});
