/**
 * A required virtual field does not block a write that omits it.
 *
 * A virtual field stores nothing: a value sent for it is dropped before the
 * write, and its value is computed in an `afterRead` hook. Requiring it on
 * create made every correct create fail with REQUIRED, and supplying a value
 * only satisfied validation for the write to discard it. The Single's first
 * read asks the same question of a group's children, so a group whose only
 * required child is virtual is still created.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, group, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [
      defineCollection({
        slug: "articles",
        fields: [
          text({ name: "title" }),
          text({ name: "author", required: true }),
          text({ name: "readingTime", required: true, virtual: true }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "site",
        fields: [
          group({
            name: "contact",
            fields: [
              text({ name: "label", defaultValue: "Support" }),
              text({ name: "computed", required: true, virtual: true }),
            ],
          }),
        ],
      }),
    ],
  });
  return current;
}

/** The paths a refused write names, or none when it was accepted. */
async function refusedPaths(write: () => Promise<unknown>): Promise<string[]> {
  try {
    await write();
    return [];
  } catch (error) {
    if (!(error instanceof NextlyError)) throw error;
    const data = error.publicData as { errors?: { path: string }[] };
    return (data.errors ?? []).map(issue => issue.path);
  }
}

describe.each(getConfiguredTestDialects())(
  "a required virtual field on %s",
  (dialect: TestDialect) => {
    it("lets a create omit it, and still requires the stored field beside it", async () => {
      const t = await boot(dialect);

      expect(
        await refusedPaths(() =>
          t.nextly.create({
            collection: "articles",
            data: { title: "Hello", author: "Ada" },
            overrideAccess: true,
          })
        )
      ).toEqual([]);
      // The stored required field is still judged, so the omission above was
      // accepted because the field is virtual, not because nothing was checked.
      expect(
        await refusedPaths(() =>
          t.nextly.create({
            collection: "articles",
            data: { title: "Hello" },
            overrideAccess: true,
          })
        )
      ).toEqual(["author"]);
    });

    it("leaves a Single's group complete when its only missing child is virtual", async () => {
      const t = await boot(dialect);

      const doc = (await t.nextly.findSingle({
        slug: "site",
        overrideAccess: true,
      })) as { contact?: { label?: string } } | null;

      expect(doc?.contact?.label).toBe("Support");
    });
  }
);
