/**
 * An update whose payload carries an own `undefined` does not clear the column.
 *
 * JSON cannot express it, so a REST caller never sends one; a server caller
 * or a hook can — `{ title: maybeTitle }` with nothing to say. The row's write
 * used to bind such a key as SQL NULL, which is why `stripUndefinedStatus`
 * exists for the one column where that turned into an unpublish. The
 * adapter-built update omits the key instead, for every column, which is the
 * meaning JSON gives an absent key and what the query builder already did for
 * every other update. Pinned against a real database because the difference
 * is in what is stored, not in what the call returns.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const notes = () =>
  defineCollection({
    slug: "undefnotes",
    fields: [text({ name: "title" }), text({ name: "body" })],
  });

function handler(t: TestNextly) {
  return t.getService("collectionsHandler");
}

/** The row as the table holds it, not as a read shapes it. */
async function storedRow(
  t: TestNextly,
  id: string
): Promise<Record<string, unknown>> {
  const rows = await t.adapter.select<Record<string, unknown>>("dc_undefnotes");
  return rows.find(r => r.id === id) ?? {};
}

describe("an update carrying an own undefined", () => {
  it("leaves the column as it was, while a sibling key in the same write lands", async () => {
    current = await createTestNextly({ collections: [notes()] });
    const created = await handler(current).createEntry(
      { collectionName: "undefnotes", overrideAccess: true },
      { title: "First", body: "one" }
    );
    const id = (created.data as { id: string }).id;

    const updated = await handler(current).updateEntry(
      { collectionName: "undefnotes", entryId: id, overrideAccess: true },
      { title: undefined, body: "two" }
    );
    expect(updated.success).toBe(true);

    // `body` proves the write reached the row; `title` is the claim.
    expect(await storedRow(current, id)).toMatchObject({
      title: "First",
      body: "two",
    });
  });

  it("still clears the column for an explicit null", async () => {
    // The control: the key is omitted for `undefined` and only for
    // `undefined`. A caller who means "clear it" says null.
    current = await createTestNextly({ collections: [notes()] });
    const created = await handler(current).createEntry(
      { collectionName: "undefnotes", overrideAccess: true },
      { title: "First", body: "one" }
    );
    const id = (created.data as { id: string }).id;

    const updated = await handler(current).updateEntry(
      { collectionName: "undefnotes", entryId: id, overrideAccess: true },
      { title: null }
    );
    expect(updated.success).toBe(true);
    expect((await storedRow(current, id)).title).toBeNull();
  });
});
