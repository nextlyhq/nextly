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

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const NOTES = "rulefilter_byid_notes";
// Drafts kept apart from the live entry, read by a key that may edit them, so
// a read asking for the working draft may be given it.
const DRAFTED = "rulefilter_byid_drafted";
// A read rule whose filter names a field the collection does not have.
const VANISHED = "rulefilter_byid_vanished";

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
      defineCollection({
        slug: DRAFTED,
        status: true,
        versions: { drafts: true },
        access: {
          read: answering({ title: { equals: "public" } }),
          update: () => true,
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: VANISHED,
        access: { read: answering({ vanished: { equals: "x" } }) },
        fields: [text({ name: "title" })],
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
async function readAsVisitor(
  t: TestNextly,
  id: string,
  collection: string = NOTES,
  draft?: boolean
): Promise<unknown> {
  try {
    const entry = await t.nextly.findByID({
      collection,
      id,
      overrideAccess: false,
      ...(draft === undefined ? {} : { draft }),
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

  it("does not overlay a working draft the filter was not asked about", async () => {
    const t = await boot();
    const made = await t.nextly.create({
      collection: DRAFTED,
      data: { title: "public", status: "published" },
    });
    const id = String((made.item as { id: string | number }).id);
    // A pending edit the filter does not match.
    await t.nextly.update({
      collection: DRAFTED,
      id,
      data: { title: "secret" },
      draft: true,
    });
    // POPULATION CONTROL: a trusted read asking for the working draft is
    // given it, so the draft is there to be shown.
    const trusted = await t.nextly.findByID({
      collection: DRAFTED,
      id,
      draft: true,
    });
    expect((trusted as { title?: unknown } | null)?.title).toBe("secret");
    // A key that may read and edit the collection is shown working drafts,
    // and its read rule answers the filter.
    const editor = apiKeyScope(
      ["read", "update"].map(action => ({
        slug: `${action}-${DRAFTED}`,
        action,
        resource: DRAFTED,
      }))
    );
    const asEditor = await t.nextly.findByID({
      collection: DRAFTED,
      id,
      draft: true,
      overrideAccess: false,
      user: { id: "key-owner" },
      actor: editor,
    });
    // The live entry the filter matched, not content the filter never saw.
    expect((asEditor as { title?: unknown } | null)?.title).toBe("public");
  });

  it("answers as missing, and lists nothing, where the rule's filter names a field the collection lacks", async () => {
    const t = await boot();
    const made = await t.nextly.create({
      collection: VANISHED,
      data: { title: "kept" },
    });
    const id = String((made.item as { id: string | number }).id);
    const gone = await t.nextly.create({
      collection: VANISHED,
      data: { title: "gone" },
    });
    const goneId = String((gone.item as { id: string | number }).id);
    await t.nextly.delete({ collection: VANISHED, id: goneId });
    // Not a validation error naming the rule's field: the read is answered
    // as a missing entry is, and the list finds nothing.
    expect(await readAsVisitor(t, id, VANISHED)).toEqual(
      await readAsVisitor(t, goneId, VANISHED)
    );
    const listed = await t.nextly.find({
      collection: VANISHED,
      overrideAccess: false,
    });
    expect(listed.items).toEqual([]);
    expect(listed.meta.total).toBe(0);
  });
});
