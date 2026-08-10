/**
 * A refused write inside a field group is reported as a refusal.
 *
 * A field group is validated inside the parent write's transaction, so a value
 * it rejects is raised from in there and has to travel out through the
 * transaction boundary. That boundary classifies what escapes it as a database
 * failure, which turned a refusal into a generic server error: the caller was
 * handed a 500 for a blank required field, and the per-field issues an admin
 * form marks the field from never arrived.
 *
 * Singles were unaffected and are kept here as the contrast — the same refusal
 * arriving intact on a path that already worked is what says the collection
 * cases are now consistent with it rather than merely different.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The refusal every case here provokes: a required field left blank. */
const BLANK = { badge: {} };

async function boot(): Promise<TestNextly> {
  return createTestNextly({
    fieldGroups: [
      defineFieldGroup({
        slug: "badged",
        fields: [text({ name: "badge", required: true })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "badge", component: "badged" }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "landing",
        fields: [
          text({ name: "headline" }),
          fieldGroup({ name: "badge", component: "badged" }),
        ],
      }),
    ],
  });
}

/** What a client needs to render the refusal, rather than just its existence. */
const REFUSAL = {
  code: "VALIDATION_ERROR",
  publicData: {
    errors: [{ path: "badge", code: "REQUIRED" }],
  },
};

describe("a field-group refusal crossing the write's transaction", () => {
  it("survives a collection create", async () => {
    current = await boot();

    const error = await current.nextly
      .create({ collection: "pages", data: { title: "A", ...BLANK } })
      .catch((e: unknown) => e);

    expect(error).toMatchObject(REFUSAL);
  });

  it("survives a collection update", async () => {
    current = await boot();
    const created = await current.nextly.create({
      collection: "pages",
      data: { title: "A", badge: { badge: "gold" } },
    });

    const error = await current.nextly
      .update({
        collection: "pages",
        id: (created.item as { id: string }).id,
        data: { badge: { badge: "" } },
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject(REFUSAL);
  });

  it("survives a single update, as it always did", async () => {
    current = await boot();

    const error = await current.nextly
      .updateSingle({ slug: "landing", data: { headline: "H", ...BLANK } })
      .catch((e: unknown) => e);

    expect(error).toMatchObject(REFUSAL);
  });

  it("leaves nothing behind when the create is refused", async () => {
    // The rollback is the other half: reporting the refusal correctly would be
    // no use if the row it refused had been written anyway.
    current = await boot();

    await current.nextly
      .create({ collection: "pages", data: { title: "A", ...BLANK } })
      .catch(() => undefined);

    const remaining = await current.nextly.find({ collection: "pages" });
    expect(remaining.items).toHaveLength(0);
  });
});
