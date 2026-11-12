/**
 * A restore made through an API key reports the fields the KEY may not write,
 * not the ones its owner may not.
 *
 * Before replaying a version, a restore asks the field write rules which of
 * its fields the restorer may set, so it can report the ones it leaves
 * behind. The update that follows judges a key on its own grants, so the
 * question must be asked of the key too: asked of the owner, a field the
 * owner may write and the key may not is reported as restored while the
 * update keeps the stored value.
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { apiKeyScope } from "../../../auth/authenticated-scope";
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

const SLUG = "keyrestores";

/** A key that may read and update the collection, but not write `secret`. */
const KEY = apiKeyScope([
  { slug: `read-${SLUG}`, action: "read", resource: SLUG },
  { slug: `update-${SLUG}`, action: "update", resource: SLUG },
]);

describe("a restore through an API key", () => {
  it("reports a field the key may not write, though its owner may", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: SLUG,
          // Kept with working drafts, which a restore writes.
          status: true,
          versions: true,
          access: { read: () => true, update: () => true, create: () => true },
          fields: [
            text({ name: "body" }),
            text({
              name: "secret",
              access: {
                update: ({ permissions }) =>
                  (permissions as string[]).includes("write-secret"),
              },
            }),
          ],
        }),
      ],
    });
    // The owner holds the grant the rule asks for; the key does not.
    await userWhoMay(current, "owner", "write", ["secret"]);
    const handler = current.getService("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { body: "b1", secret: "s1" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: SLUG, entryId: id, overrideAccess: true },
      { body: "b2", secret: "s2", _overwrite: true }
    );

    const result = await restoreVersion({
      scopeKind: "collection",
      slug: SLUG,
      entryId: id,
      versionNo: 1,
      user: { id: "owner" },
      authenticatedScope: KEY,
      version: { _overwrite: true },
    });

    expect(result.droppedFields).toEqual(["secret"]);
    const after = await handler.getEntry({
      collectionName: SLUG,
      entryId: id,
      overrideAccess: true,
      status: "all",
    });
    const doc = after.data as { body?: string; secret?: string };
    // What the report says matches what the update did.
    expect([doc.body, doc.secret]).toEqual(["b1", "s2"]);
  });
});
