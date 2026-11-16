/**
 * A field group placed directly in another is stored, read and removed at any depth.
 *
 * Each level is a row of its own field group's table, whose parent is the row of the level above.
 * The chain here is five levels deep (l1 holds l2 ... holds l5), reached from a collection's single
 * slot, a repeatable list and a zone, and from a Single. What each case asserts is read back
 * through the API, and where rows should be gone, counted in the tables themselves: a write that
 * stored nothing reads back as absent, and a delete that left rows behind reads back the same.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { writeFieldGroupType } from "../storage/field-group-type-key";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const LEVELS = ["l1", "l2", "l3", "l4", "l5"] as const;

/** Level `i`'s field group: a title, and the next level placed directly in it. */
function level(i: number) {
  const next = LEVELS[i + 1];
  return defineFieldGroup({
    slug: LEVELS[i],
    fields: [
      text({ name: "title" }),
      ...(next === undefined
        ? []
        : [fieldGroup({ name: next, component: next })]),
    ],
  });
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: LEVELS.map((_, i) => level(i)),
    collections: [
      defineCollection({
        slug: "pages",
        fields: [
          text({ name: "name" }),
          fieldGroup({ name: "top", component: "l1" }),
          fieldGroup({ name: "tops", component: "l1", repeatable: true }),
          fieldGroup({ name: "zone", components: ["l1"] }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        fields: [fieldGroup({ name: "top", component: "l1" })],
      }),
    ],
  });
  return current;
}

type Chain = { title: string; [next: string]: unknown };

/** A value five levels deep, each level's title marked with `tag`. */
function chain(tag: string, from = 0): Chain {
  const value: Chain = { title: `${tag}-${LEVELS[from]}` };
  const next = LEVELS[from + 1];
  if (next !== undefined) value[next] = chain(tag, from + 1);
  return value;
}

/** The titles down a read value's chain, level by level. */
function titlesOf(value: unknown): string[] {
  const titles: string[] = [];
  let at = value as Chain | undefined;
  for (let i = 0; at !== undefined && at !== null; i++) {
    titles.push(at.title);
    const next = LEVELS[i + 1];
    at = next === undefined ? undefined : (at[next] as Chain | undefined);
  }
  return titles;
}

/** Rows each level's table holds. */
async function rowCounts(t: TestNextly): Promise<number[]> {
  const counts: number[] = [];
  for (const slug of LEVELS) {
    counts.push((await t.adapter.select(`comp_${slug}`, {})).length);
  }
  return counts;
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`a field group placed directly in another is stored at any depth — ${dialect}`, () => {
    it("stores and reads every level of a single slot", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "pages" as never,
        data: { name: "P", top: chain("a") } as never,
      });
      const id = (created.item as { id: string }).id;

      const read = (await t.nextly.findByID({
        collection: "pages" as never,
        id: id as never,
      })) as Record<string, unknown>;
      expect(titlesOf(read.top)).toEqual([
        "a-l1",
        "a-l2",
        "a-l3",
        "a-l4",
        "a-l5",
      ]);
      expect(await rowCounts(t)).toEqual([1, 1, 1, 1, 1]);
    });

    it("updates a level deep in the chain and keeps the others", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "pages" as never,
        data: { name: "P", top: chain("a") } as never,
      });
      const id = (created.item as { id: string }).id;

      const changed = chain("a");
      (((changed.l2 as Chain).l3 as Chain).l4 as Chain as Chain).title = "b-l4";
      await t.nextly.update({
        collection: "pages" as never,
        id: id as never,
        data: { top: changed, _overwrite: true } as never,
      });

      const read = (await t.nextly.findByID({
        collection: "pages" as never,
        id: id as never,
      })) as Record<string, unknown>;
      expect(titlesOf(read.top)).toEqual([
        "a-l1",
        "a-l2",
        "a-l3",
        "b-l4",
        "a-l5",
      ]);
      // Updated in place: no level gained a second row.
      expect(await rowCounts(t)).toEqual([1, 1, 1, 1, 1]);
    });

    it("clearing a level removes it and every level below it", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "pages" as never,
        data: { name: "P", top: chain("a") } as never,
      });
      const id = (created.item as { id: string }).id;

      const cut = chain("a");
      (cut.l2 as Chain).l3 = null;
      await t.nextly.update({
        collection: "pages" as never,
        id: id as never,
        data: { top: cut, _overwrite: true } as never,
      });

      const read = (await t.nextly.findByID({
        collection: "pages" as never,
        id: id as never,
      })) as Record<string, unknown>;
      expect(titlesOf(read.top)).toEqual(["a-l1", "a-l2"]);
      expect(await rowCounts(t)).toEqual([1, 1, 0, 0, 0]);
    });

    it("stores each item of a repeatable list with its own chain, and removing an item removes its chain", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "pages" as never,
        data: { name: "P", tops: [chain("x"), chain("y")] } as never,
      });
      const id = (created.item as { id: string }).id;

      const read = (await t.nextly.findByID({
        collection: "pages" as never,
        id: id as never,
      })) as Record<string, unknown>;
      const items = read.tops as Chain[];
      expect(items.map(titlesOf)).toEqual([
        ["x-l1", "x-l2", "x-l3", "x-l4", "x-l5"],
        ["y-l1", "y-l2", "y-l3", "y-l4", "y-l5"],
      ]);
      expect(await rowCounts(t)).toEqual([2, 2, 2, 2, 2]);

      // Keep the second item only, by its id.
      await t.nextly.update({
        collection: "pages" as never,
        id: id as never,
        data: { tops: [items[1]], _overwrite: true } as never,
      });
      const after = (await t.nextly.findByID({
        collection: "pages" as never,
        id: id as never,
      })) as Record<string, unknown>;
      expect((after.tops as Chain[]).map(titlesOf)).toEqual([
        ["y-l1", "y-l2", "y-l3", "y-l4", "y-l5"],
      ]);
      expect(await rowCounts(t)).toEqual([1, 1, 1, 1, 1]);
    });

    it("stores a chain held in a zone", async () => {
      const t = await boot(dialect);
      const item: Record<string, unknown> = { ...chain("z") };
      writeFieldGroupType(item, "l1");
      const created = await t.nextly.create({
        collection: "pages" as never,
        // A zone that is not repeatable holds one item, of any field group it allows.
        data: { name: "P", zone: item } as never,
      });
      const id = (created.item as { id: string }).id;
      // Every level was stored as a row.
      expect(await rowCounts(t)).toEqual([1, 1, 1, 1, 1]);

      const read = (await t.nextly.findByID({
        collection: "pages" as never,
        id: id as never,
      })) as Record<string, unknown>;
      // A zone is read as a list, holding here its one item.
      expect((read.zone as Chain[]).map(titlesOf)).toEqual([
        ["z-l1", "z-l2", "z-l3", "z-l4", "z-l5"],
      ]);
    });

    it("deleting the entry leaves no row at any level", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "pages" as never,
        data: { name: "P", top: chain("a"), tops: [chain("b")] } as never,
      });
      const id = (created.item as { id: string }).id;
      expect(await rowCounts(t)).toEqual([2, 2, 2, 2, 2]);

      await t.nextly.delete({ collection: "pages" as never, id: id as never });
      expect(await rowCounts(t)).toEqual([0, 0, 0, 0, 0]);
    });

    it("stores and reads every level in a Single", async () => {
      const t = await boot(dialect);
      await t.nextly.updateSingle({
        slug: "home" as never,
        data: { top: chain("s"), _overwrite: true } as never,
      });
      const read = (await t.nextly.findSingle({
        slug: "home" as never,
      })) as Record<string, unknown>;
      expect(titlesOf(read.top)).toEqual([
        "s-l1",
        "s-l2",
        "s-l3",
        "s-l4",
        "s-l5",
      ]);
    });
  });
}
