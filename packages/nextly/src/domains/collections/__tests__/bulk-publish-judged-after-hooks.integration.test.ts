// A bulk update a hook turns into a publish is judged as a publish.
//
// The batch path writes the caller's fields onto the stored row, so a publish
// there puts the stored row live. Whether a write publishes is the hooks' to
// decide as much as the caller's: a `beforeChange` hook can set the status.
// Judged before the hooks, such a write is not yet a publish, and the stored
// row goes live unjudged.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import type { HookContext } from "../../../hooks/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface Batch {
  updateEntries(
    params: { collectionName: string; overrideAccess?: boolean },
    entries: { id: string; data: Record<string, unknown> }[],
    options?: { skipHooks?: boolean }
  ): Promise<{ successful: number; failed: number }>;
}

describe("a bulk update a hook turns into a publish", () => {
  it("is refused when the stored row it puts live breaks a rule", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "bulletins",
          status: true,
          hooks: {
            beforeChange: [
              (ctx: HookContext) => ({
                ...(ctx.data as Record<string, unknown>),
                status: "published",
              }),
            ],
          },
          fields: [
            text({
              name: "title",
              validate: (value: unknown) =>
                value !== "retired" || "title cannot be retired",
            }),
            text({ name: "tag" }),
          ],
        }),
      ],
    });
    const t = current;
    const created = await t.nextly.create({
      collection: "bulletins",
      data: { title: "Ok", tag: "a", status: "draft" },
      overrideAccess: true,
    });
    const id = String(created.item.id);
    // The stored title breaks the rule, written past every check as an older
    // writer could have left it; the row is still a draft.
    await t.adapter.update(
      "dc_bulletins",
      { title: "retired", status: "draft" },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    const batch = (
      t.getService("collectionsHandler") as unknown as {
        getEntryService(): Batch;
      }
    ).getEntryService();

    const result = await batch.updateEntries(
      { collectionName: "bulletins", overrideAccess: true },
      [{ id, data: { tag: "b" } }]
    );

    expect(result.failed, JSON.stringify(result)).toBe(1);
  });
});

describe("a status-only publish on a collection that keeps no drafts", () => {
  it("is refused when the stored row it puts live breaks a rule", async () => {
    // No working draft can exist here: the row as stored is what every
    // publish puts live.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "memos",
          status: true,
          fields: [
            text({
              name: "title",
              validate: (value: unknown) =>
                value !== "retired" || "title cannot be retired",
            }),
          ],
        }),
      ],
    });
    const t = current;
    const created = await t.nextly.create({
      collection: "memos",
      data: { title: "Ok", status: "draft" },
      overrideAccess: true,
    });
    const id = String(created.item.id);
    await t.adapter.update(
      "dc_memos",
      { title: "retired" },
      { and: [{ column: "id", op: "=", value: id }] }
    );

    const refused = await t.nextly
      .update({
        collection: "memos",
        id,
        data: { status: "published" },
        overrideAccess: true,
      })
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(
      (
        refused as { publicData?: { errors?: { path: string }[] } } | undefined
      )?.publicData?.errors?.map(issue => issue.path)
    ).toEqual(["title"]);
  });
});
