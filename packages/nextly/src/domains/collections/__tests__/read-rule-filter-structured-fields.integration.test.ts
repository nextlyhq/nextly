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
 * Asked as a visitor, whom the Public role grants the read, so the
 * collection's rule is what narrows it; on each configured database, since
 * the column a structured field is stored in differs by dialect.
 *
 * @module domains/collections/__tests__/read-rule-filter-structured-fields.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { grantPublic } from "../../../__tests__/helpers/public-role";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, option, select, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { consoleLogger } from "../../../shared/types";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const TAGGED = "rulefilter_structured_tagged";
const SORTED = "rulefilter_structured_sorted";

/** A read rule answering `value`, unchecked by the filter type, as untyped code may. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
  vi.restoreAllMocks();
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const options = [option("a"), option("b")];
  current = await createTestNextly({
    dialect,
    // The cases read as a visitor, judged by the Public role a real boot
    // makes. Each read rule answers a filter rather than `true`, so boot
    // grants Public no read of them; it is granted below, as a site admin
    // would, so the filter is what decides which entries a visitor sees.
    seedPublic: true,
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
    ],
  });
  await grantPublic(current, [`read-${TAGGED}`, `read-${SORTED}`]);
  // Boot's seeding asks each read rule as a visitor to decide the Public
  // role's grants, which reports a rule's misuse once; it is forgotten here
  // so the report the case counts is its own read's.
  clearRuleFilterReports();
  return current;
}

const asVisitor = { overrideAccess: false } as const;

const titles = (items: readonly unknown[]) =>
  items.map(item => (item as { title?: unknown }).title).sort();

describe.each(getConfiguredTestDialects())(
  "a read rule's filter on a field stored as JSON (%s)",
  dialect => {
    it("matches no entry, and the rule is reported", async () => {
      const t = await boot(dialect);
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
  }
);
