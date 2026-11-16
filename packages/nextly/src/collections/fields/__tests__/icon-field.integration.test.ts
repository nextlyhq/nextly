/**
 * An icon field end to end, on every dialect this machine can reach: boot
 * creates its column, a write stores the id as the plain string it is, a read
 * returns it unchanged, the declared default fills an omitted value, and a
 * value that is not an id's shape is refused before it reaches the column.
 *
 * Only the shape is judged. An id from a set nobody registered is stored as
 * given, because icon sets are registered at runtime.
 */
import { afterEach, expect, it } from "vitest";

import { defineCollection, icon, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

const SLUG = "icon_field_probes";
const TABLE = `dc_${SLUG}`;

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect("icon field", dialect => {
  const boot = async (): Promise<TestNextly> => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: SLUG,
          fields: [
            text({ name: "title" }),
            icon({ name: "badge" }),
            icon({ name: "marker", defaultValue: "lucide:map-pin" }),
          ],
        }),
      ],
    });
    return current;
  };

  it("stores an icon id as a plain string and reads it back unchanged", async () => {
    const t = await boot();
    const { item: created } = await t.nextly.create({
      collection: SLUG,
      data: { title: "starred", badge: "lucide:star" },
    });
    expect(created.badge).toBe("lucide:star");
    // The declared default fills a value the write left out.
    expect(created.marker).toBe("lucide:map-pin");

    const read = (await t.nextly.findByID({
      collection: SLUG,
      id: String(created.id),
    })) as Record<string, unknown>;
    expect(read.badge).toBe("lucide:star");
    expect(read.marker).toBe("lucide:map-pin");

    // The column holds the id itself, not an encoded or wrapped value.
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const rows = await t.adapter.executeQuery<{ badge: unknown }>(
      `SELECT ${q("badge")} AS badge FROM ${q(TABLE)}`
    );
    expect(rows.map(row => row.badge)).toEqual(["lucide:star"]);
  }, 60_000);

  it("stores an id from an unregistered set, and refuses a value that is not an id", async () => {
    const t = await boot();
    const { item: unknownSet } = await t.nextly.create({
      collection: SLUG,
      data: { title: "unknown set", badge: "acme:rocket" },
    });
    expect(unknownSet.badge).toBe("acme:rocket");

    await expect(
      t.nextly.create({
        collection: SLUG,
        data: { title: "not an id", badge: "Star" },
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }, 60_000);
});
