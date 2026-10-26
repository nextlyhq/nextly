/**
 * A collection read rule that answers a filter limits a list, its total and a
 * count to the entries the filter matches.
 *
 * The access table shows that a list returns the matching probe row and
 * withholds the other. This file holds the properties the table cannot see:
 * the total and the pages describe the matching entries alone, a read hook
 * that rewrites the caller's filter cannot drop the rule's, the rule's filter
 * may name a field the caller cannot read, and a filter no read can apply is
 * refused rather than ignored.
 *
 * Asked as a visitor through the Direct API, so no stored role is needed: a
 * visitor's read is judged by the collection's read rule alone.
 *
 * @module domains/collections/__tests__/read-rule-filter-limits-lists.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, json, text } from "../../../config";
import {
  registerBeforeOperationHook,
  unregisterBeforeOperationHook,
} from "../../../hooks";
import type { BeforeOperationHandler } from "../../../hooks/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { consoleLogger } from "../../../shared/types";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const NOTES = "rulefilter_notes";
// The same rule over a field the caller may read, so a read is refused for no
// reason but the one a test is watching.
const OPEN_NOTES = "rulefilter_open_notes";
const PLACES = "rulefilter_places";
// A rule whose filter changes with every call, as one built from state that
// moves between calls would.
const SHIFTING = "rulefilter_shifting";
let shiftingCalls = 0;

/** A read rule answering `value`, which the rule type does not allow yet. */
const answering = (value: unknown) => () => value as boolean;
/** A read rule answering what `next` returns on each call. */
const answeringEach = (next: () => unknown) => () => next() as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
  vi.restoreAllMocks();
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: NOTES,
        access: { read: answering({ team: { equals: "public" } }) },
        fields: [
          text({ name: "title" }),
          // No caller may read `team`, so a filter the caller writes on it is
          // refused. The rule's own filter names it all the same.
          text({ name: "team", access: { read: () => false } }),
        ],
      }),
      defineCollection({
        slug: OPEN_NOTES,
        access: { read: answering({ team: { equals: "public" } }) },
        fields: [text({ name: "title" }), text({ name: "team" })],
      }),
      defineCollection({
        slug: SHIFTING,
        access: {
          read: answeringEach(() => {
            shiftingCalls += 1;
            return {
              team: { equals: shiftingCalls === 1 ? "public" : "staff" },
            };
          }),
        },
        fields: [text({ name: "title" }), text({ name: "team" })],
      }),
      defineCollection({
        slug: PLACES,
        access: {
          read: answering({ spot: { near: "-74.006,40.7128,10000" } }),
        },
        fields: [text({ name: "title" }), json({ name: "spot" })],
      }),
    ],
  });
  return current;
}

/** Three entries the rule's filter matches, and two it does not. */
async function seed(t: TestNextly, collection: string = NOTES): Promise<void> {
  for (const [title, team] of [
    ["public-1", "public"],
    ["public-2", "public"],
    ["public-3", "public"],
    ["staff-1", "staff"],
    ["staff-2", "staff"],
  ]) {
    await t.nextly.create({ collection, data: { title, team } });
  }
}

/** A visitor's checked read of the notes. */
const asVisitor = { overrideAccess: false } as const;

const titles = (items: readonly unknown[]) =>
  items.map(item => (item as { title?: unknown }).title).sort();

describe("a read rule that answers a filter", () => {
  it("limits a list to the matching entries, and its total and pages count them alone", async () => {
    const t = await boot();
    await seed(t);

    const page = await t.nextly.find({
      collection: NOTES,
      limit: 2,
      ...asVisitor,
    });
    expect(page.items).toHaveLength(2);
    expect(
      titles(page.items).every(title => String(title).startsWith("public"))
    ).toBe(true);
    // Three matching entries of five, two to a page.
    expect(page.meta.total).toBe(3);
    expect(page.meta.totalPages).toBe(2);

    const last = await t.nextly.find({
      collection: NOTES,
      limit: 2,
      page: 2,
      ...asVisitor,
    });
    expect(titles(last.items)).toHaveLength(1);
    expect(titles([...page.items, ...last.items])).toEqual([
      "public-1",
      "public-2",
      "public-3",
    ]);
  });

  it("counts a list's total under the filter its page was read with, asking the rule once", async () => {
    const t = await boot();
    await seed(t, SHIFTING);
    shiftingCalls = 0;
    const listed = await t.nextly.find({ collection: SHIFTING, ...asVisitor });
    expect(shiftingCalls).toBe(1);
    // Three public entries on the page, and the total says three: not the two
    // a second answer of the rule would match.
    expect(titles(listed.items)).toEqual(["public-1", "public-2", "public-3"]);
    expect(listed.meta.total).toBe(3);
  });

  it("limits a count to the matching entries", async () => {
    const t = await boot();
    await seed(t);
    expect(
      (await t.nextly.count({ collection: NOTES, ...asVisitor })).total
    ).toBe(3);
  });

  it("narrows the caller's own filter, rather than widening or replacing it", async () => {
    const t = await boot();
    await seed(t);
    const matching = await t.nextly.find({
      collection: NOTES,
      where: { title: { equals: "public-2" } },
      ...asVisitor,
    });
    expect(titles(matching.items)).toEqual(["public-2"]);
    // An entry the caller asks for by name, outside the rule's filter, is not
    // returned.
    const outside = await t.nextly.find({
      collection: NOTES,
      where: { title: { equals: "staff-1" } },
      ...asVisitor,
    });
    expect(outside.items).toEqual([]);
    expect(outside.meta.total).toBe(0);
  });

  it("holds when a read hook rewrites the caller's filter", async () => {
    const t = await boot();
    await seed(t, OPEN_NOTES);
    // A hook may replace the caller's filter wholesale; the rule's is not the
    // caller's, so it is not the hook's to drop.
    const widen: BeforeOperationHandler = ctx => ({
      ...(ctx.args as object),
      where: {},
    });
    registerBeforeOperationHook(OPEN_NOTES, widen);
    try {
      const asked = { where: { title: { equals: "public-2" } }, ...asVisitor };
      const listed = await t.nextly.find({ collection: OPEN_NOTES, ...asked });
      // Three, not one: the hook did replace the caller's filter. And three,
      // not five: the rule's filter held, on the page and on its total, which
      // is counted apart from it.
      expect(titles(listed.items)).toEqual([
        "public-1",
        "public-2",
        "public-3",
      ]);
      expect(listed.meta.total).toBe(3);
      expect(
        (await t.nextly.count({ collection: OPEN_NOTES, ...asked })).total
      ).toBe(3);
    } finally {
      unregisterBeforeOperationHook(OPEN_NOTES, widen);
    }
  });

  it("may name a field the caller cannot read, where the caller's own filter may not", async () => {
    const t = await boot();
    await seed(t);
    // POPULATION CONTROL: `team` is hidden from this caller, so a filter the
    // caller writes on it is refused.
    await expect(
      t.nextly.find({
        collection: NOTES,
        where: { team: { equals: "staff" } },
        ...asVisitor,
      })
    ).rejects.toMatchObject({ statusCode: expect.any(Number) });
    // The rule's filter names the same field, and the read is answered.
    const listed = await t.nextly.find({ collection: NOTES, ...asVisitor });
    expect(listed.meta.total).toBe(3);
  });

  it("refuses a filter using near, and reports it once, rather than reading every entry", async () => {
    const t = await boot();
    await t.nextly.create({ collection: PLACES, data: { title: "a place" } });
    const reported = vi
      .spyOn(consoleLogger, "error")
      .mockImplementation(() => {});
    await expect(
      t.nextly.find({ collection: PLACES, ...asVisitor })
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      t.nextly.count({ collection: PLACES, ...asVisitor })
    ).rejects.toMatchObject({ statusCode: 403 });
    const reports = reported.mock.calls
      .map(call => String(call[0]))
      .filter(message => message.includes(`read rule of "${PLACES}"`));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("near");
  });
});
