/**
 * A restore of what the working draft already holds is recorded in history,
 * and pins no version.
 *
 * A save that changes nothing records nothing, and a restore writes through
 * the same draft save. But a restore is an act someone made: answered
 * "Version restored", it leaves its event in the document's history, naming
 * the version it came from. It captures no version of its own, as it changed
 * nothing: a restore's version is one retention keeps, so a repeated restore
 * that captured one each time would keep every one of them past the cap.
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
  it("is recorded as an event naming its version, and captures no version", async () => {
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
    const restoreEventsOf = async () =>
      (
        await current!.nextly.contentEvents.list({
          subject: { kind: "collection", slug: SLUG, id },
          limit: 100,
        })
      ).items.filter(
        event =>
          event.kind === "restored" &&
          (event.payload as { from?: unknown } | null)?.from === 1
      ).length;

    await restore();
    const versionsAfterFirst = await restoresOf();
    const eventsAfterFirst = await restoreEventsOf();
    // The draft now holds version 1's content; restoring it again changes
    // nothing: it is recorded as an event, and captures no version.
    await restore();
    await restore();

    expect(versionsAfterFirst).toBeGreaterThan(0);
    expect(await restoreEventsOf()).toBe(eventsAfterFirst + 2);
    expect(await restoresOf()).toBe(versionsAfterFirst);
  });
});
