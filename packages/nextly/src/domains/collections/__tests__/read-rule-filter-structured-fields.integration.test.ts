/**
 * A read rule's filter naming a field stored as serialized JSON, such as a
 * `hasMany` select, is refused: it matches no entry, and the rule is reported.
 *
 * Its column holds a document (`["a"]`), so an operator comparing it with one
 * value compares the document's text. Applied as written, `not_equals: "a"`
 * would admit an entry whose list holds `a`, the one the rule meant to refuse.
 * The same rule on a plain select is the control: it admits the entry whose
 * value differs, so the refusal is the structured field's, not the rule's.
 *
 * Asked as a visitor, whose read is judged by the collection's rule alone.
 *
 * A delete rule's filter is refused the same way: applied as written, the
 * entry whose list holds `a` would be deleted. Asked as a signed-in user
 * holding the read and delete permissions, so the rule is what narrows them.
 *
 * @module domains/collections/__tests__/read-rule-filter-structured-fields.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, option, select, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { consoleLogger } from "../../../shared/types";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const TAGGED = "rulefilter_structured_tagged";
const SORTED = "rulefilter_structured_sorted";
// The same filters as delete rules, over collections anyone signed in may read.
const TAGGED_DELETES = "rulefilter_structured_tagged_deletes";
const SORTED_DELETES = "rulefilter_structured_sorted_deletes";
const AUTHOR = "rulefilter-structured-author";

/** A read rule answering `value`, unchecked by the filter type, as untyped code may. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
  vi.restoreAllMocks();
});

async function boot(): Promise<TestNextly> {
  const options = [option("a"), option("b")];
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: TAGGED,
        access: { read: answering({ tags: { not_equals: "a" } }) },
        fields: [
          text({ name: "title" }),
          select({ name: "tags", hasMany: true, options }),
        ],
      }),
      defineCollection({
        slug: SORTED,
        access: { read: answering({ tag: { not_equals: "a" } }) },
        fields: [text({ name: "title" }), select({ name: "tag", options })],
      }),
      defineCollection({
        slug: TAGGED_DELETES,
        access: {
          read: () => true,
          delete: answering({ tags: { not_equals: "a" } }),
        },
        fields: [
          text({ name: "title" }),
          select({ name: "tags", hasMany: true, options }),
        ],
      }),
      defineCollection({
        slug: SORTED_DELETES,
        access: {
          read: () => true,
          delete: answering({ tag: { not_equals: "a" } }),
        },
        fields: [text({ name: "title" }), select({ name: "tag", options })],
      }),
    ],
  });
  // A code rule only narrows a permission, so the author holds both.
  const deletable = [TAGGED_DELETES, SORTED_DELETES];
  await userWhoMay(current, AUTHOR, "read", deletable);
  await grantTo(current, AUTHOR, "delete", deletable);
  return current;
}

const asVisitor = { overrideAccess: false } as const;

const titles = (items: readonly unknown[]) =>
  items.map(item => (item as { title?: unknown }).title).sort();

describe("a read rule's filter on a field stored as JSON", () => {
  it("matches no entry, and the rule is reported", async () => {
    const t = await boot();
    await t.nextly.create({
      collection: TAGGED,
      data: { title: "holds-a", tags: ["a"] },
    });
    await t.nextly.create({
      collection: TAGGED,
      data: { title: "holds-b", tags: ["b"] },
    });
    await t.nextly.create({
      collection: SORTED,
      data: { title: "is-a", tag: "a" },
    });
    await t.nextly.create({
      collection: SORTED,
      data: { title: "is-b", tag: "b" },
    });
    const errors = vi.spyOn(consoleLogger, "error");

    // The control: on a plain select the rule admits the entry it does not
    // name, so the filter is applied.
    const sorted = await t.nextly.find({ collection: SORTED, ...asVisitor });
    expect(titles(sorted.items)).toEqual(["is-b"]);

    const tagged = await t.nextly.find({ collection: TAGGED, ...asVisitor });
    expect(titles(tagged.items)).toEqual([]);
    expect(
      (await t.nextly.count({ collection: TAGGED, ...asVisitor })).total
    ).toBe(0);
    expect(
      errors.mock.calls.some(([message]) =>
        String(message).includes(`"${TAGGED}"`)
      )
    ).toBe(true);
  });
});

describe("a delete rule's filter on a field stored as JSON", () => {
  const asAuthor = { overrideAccess: false, user: { id: AUTHOR } } as const;
  const stillThere = async (t: TestNextly, collection: string, id: string) =>
    (await t.nextly.find({ collection, where: { id: { equals: id } } })).items
      .length === 1;

  it("deletes nothing, the entry the rule meant to refuse included, and the rule is reported", async () => {
    const t = await boot();
    const holdsA = String(
      (
        await t.nextly.create({
          collection: TAGGED_DELETES,
          data: { title: "holds-a", tags: ["a"] },
        })
      ).item.id
    );
    const isB = String(
      (
        await t.nextly.create({
          collection: SORTED_DELETES,
          data: { title: "is-b", tag: "b" },
        })
      ).item.id
    );
    const errors = vi.spyOn(consoleLogger, "error");

    // The control: on a plain select the rule deletes the entry it does not
    // name, so the filter is applied.
    await t.nextly.delete({ collection: SORTED_DELETES, id: isB, ...asAuthor });
    expect(await stillThere(t, SORTED_DELETES, isB)).toBe(false);

    const refused = await t.nextly
      .delete({ collection: TAGGED_DELETES, id: holdsA, ...asAuthor })
      .then(
        () => undefined,
        (error: unknown) => error
      );
    expect(refused).toBeDefined();
    expect(await stillThere(t, TAGGED_DELETES, holdsA)).toBe(true);
    expect(
      errors.mock.calls.some(([message]) =>
        String(message).includes(`"${TAGGED_DELETES}"`)
      )
    ).toBe(true);
  });
});
