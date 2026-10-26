/**
 * A read by id under a collection read rule that answers a filter finds an
 * entry the filter matches, and answers one it does not match exactly as it
 * answers an entry that does not exist.
 *
 * The property that separates a correct read from a plausible broken one is
 * the second: a read that refused the entry, or answered it with a different
 * status or words, would tell the caller the entry is there. So the answer
 * for an entry outside the filter is compared whole with the answer for an
 * id no entry has.
 *
 * Asked as a visitor through the Direct API, so no stored role is needed: a
 * visitor's read is judged by the collection's read rule alone.
 *
 * @module domains/collections/__tests__/read-rule-filter-limits-by-id.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const NOTES = "rulefilter_byid_notes";

/** A read rule answering `value`, which the rule type does not allow yet. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: NOTES,
        access: { read: answering({ team: { equals: "public" } }) },
        fields: [text({ name: "title" }), text({ name: "team" })],
      }),
    ],
  });
  return current;
}

/** An entry, made trusted, and its id. */
async function made(t: TestNextly, title: string, team: string) {
  const created = await t.nextly.create({
    collection: NOTES,
    data: { title, team },
  });
  return String((created.item as { id: string | number }).id);
}

/** What a visitor's read by id answers: the entry, or the refusal whole. */
async function readAsVisitor(t: TestNextly, id: string): Promise<unknown> {
  try {
    const entry = await t.nextly.findByID({
      collection: NOTES,
      id,
      overrideAccess: false,
    });
    return { found: (entry as { title?: unknown } | null)?.title ?? null };
  } catch (error) {
    const refused = error as {
      name?: unknown;
      message?: unknown;
      statusCode?: unknown;
      code?: unknown;
      publicData?: unknown;
    };
    return {
      refused: {
        name: refused.name,
        message: refused.message,
        statusCode: refused.statusCode,
        code: refused.code,
        publicData: refused.publicData,
      },
    };
  }
}

describe("a read by id under a read rule that answers a filter", () => {
  it("finds an entry the filter matches", async () => {
    const t = await boot();
    const id = await made(t, "public-1", "public");
    expect(await readAsVisitor(t, id)).toEqual({ found: "public-1" });
  });

  it("answers an entry outside the filter exactly as an id no entry has", async () => {
    const t = await boot();
    const outside = await made(t, "staff-1", "staff");
    // An id an entry had, so it has an entry's shape and no entry now.
    const gone = await made(t, "staff-2", "staff");
    await t.nextly.delete({ collection: NOTES, id: gone });

    const missing = await readAsVisitor(t, gone);
    // POPULATION CONTROL: a missing entry is refused, so the comparison is of
    // two refusals, not of two empty answers.
    expect(missing).toMatchObject({ refused: { statusCode: 404 } });
    expect(await readAsVisitor(t, outside)).toEqual(missing);
  });
});
