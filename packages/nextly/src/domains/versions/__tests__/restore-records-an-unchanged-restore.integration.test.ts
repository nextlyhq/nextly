/**
 * A restore is recorded in history even when the working draft already holds
 * the version's content.
 *
 * A save that changes nothing records nothing, and a restore writes through
 * the same draft save. But a restore is an act someone made, with a source
 * the history shows ("Restored from version 1") and retention keeps: answered
 * "Version restored" while history gains no row, it would leave no trace.
 */
import { afterEach, describe, expect, it } from "vitest";

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

const SLUG = "sameposts";

describe("a restore of what the draft already holds", () => {
  it("is still recorded, with the version it came from", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: SLUG,
          status: true,
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler = current.getService("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { title: "one", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: SLUG, entryId: id, overrideAccess: true },
      { title: "two", status: "published", _overwrite: true }
    );
    const restore = () =>
      restoreVersion({
        scopeKind: "collection",
        slug: SLUG,
        entryId: id,
        versionNo: 1,
        version: { _overwrite: true },
      });
    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: SLUG,
      entryId: id,
    };
    const restoresOf = async () =>
      (
        await current!.getService("versionsService").list(ref, { limit: 50 })
      ).filter(row => row.sourceVersionNo === 1).length;

    await restore();
    const afterFirst = await restoresOf();
    // The draft now holds version 1's content; restoring it again changes
    // nothing, and is still recorded.
    await restore();

    expect(afterFirst).toBeGreaterThan(0);
    expect(await restoresOf()).toBe(afterFirst + 1);
  });
});
