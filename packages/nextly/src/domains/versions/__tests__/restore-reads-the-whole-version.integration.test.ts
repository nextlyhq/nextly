/**
 * A partial restore judges each chosen field against the whole version.
 *
 * A field read rule may consult the document's other values. A restore that
 * judged a chosen field after removing the fields not chosen would judge it
 * against a document the version never was: a rule hiding `secret` when
 * `tier` is "private" would see no `tier` and let the hidden value back.
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { restoreVersion } from "../restore-version";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "tiernotes";
const READER = { id: "reader", email: "reader@x.test" };

describe("a partial restore", () => {
  it("judges a chosen field by the version's values it does not restore", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: SLUG,
          // Kept with working drafts, which a restore writes.
          status: true,
          versions: true,
          access: { read: () => true, update: () => true, create: () => true },
          fields: [
            text({ name: "title" }),
            text({ name: "tier" }),
            text({
              name: "secret",
              access: {
                read: ({ data }) =>
                  (data as { tier?: unknown } | undefined)?.tier !== "private",
              },
            }),
          ],
        }),
      ],
    });
    await userWhoMay(current, READER.id, "update", [SLUG]);
    const handler = current.getService("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { title: "T1", tier: "private", secret: "S-1" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: SLUG, entryId: id, overrideAccess: true },
      { title: "T2", tier: "public", secret: "S-2", _overwrite: true }
    );

    // Version 1 was private, so its secret is hidden from this reader, even
    // though its tier is not among the fields restored.
    const result = await restoreVersion({
      scopeKind: "collection",
      slug: SLUG,
      entryId: id,
      versionNo: 1,
      user: READER,
      fields: ["title", "secret"],
      version: { _overwrite: true },
    });

    expect(result.droppedFields).toEqual(["secret"]);
    const after = await handler.getEntry({
      collectionName: SLUG,
      entryId: id,
      overrideAccess: true,
      status: "all",
    });
    const doc = after.data as Record<string, unknown>;
    expect([doc.title, doc.tier, doc.secret]).toEqual(["T1", "public", "S-2"]);
  });
});
