/**
 * A caller whose read is limited to a read rule's filter is shown the live
 * entry, never its pending working draft, even where they may publish it.
 *
 * A caller who may publish an entry is otherwise shown its pending change,
 * since they could put it live. The filter, though, was judged against the
 * live row: the draft's content, which it never saw, could lie outside it. So
 * the property that separates a correct answer from a plausible broken one is
 * the combination: a publisher under a filter reads the live entry, while the
 * same publisher on a collection with no read rule reads the draft.
 *
 * @module domains/collections/__tests__/read-rule-filter-hides-drafts-from-publishers.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const FILTERED = "rulefilter_pubdraft_filtered";
const OPEN = "rulefilter_pubdraft_open";
/** May update and publish: writes the draft. */
const EDITOR = "rulefilter-pubdraft-editor";
/** May read and publish, and holds no update. */
const PUBLISHER = "rulefilter-pubdraft-publisher";

/** A read rule answering `value`, which the rule type does not allow yet. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  const fields = [text({ name: "body" }), text({ name: "team" })];
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: FILTERED,
        status: true,
        versions: { drafts: true },
        access: { read: answering({ team: { equals: "public" } }) },
        fields,
      }),
      defineCollection({
        slug: OPEN,
        status: true,
        versions: { drafts: true },
        fields,
      }),
    ],
  });
  const both = [FILTERED, OPEN];
  await userWhoMay(current, EDITOR, "update", both);
  for (const action of ["read", "publish"]) {
    await grantTo(current, EDITOR, action, both);
  }
  await userWhoMay(current, PUBLISHER, "publish", both);
  await grantTo(current, PUBLISHER, "read", both);
  return current;
}

/** The Direct API as `id`, judged by that user's own grants. */
const as = (id: string) =>
  new Nextly({ overrideAccess: false, user: { id } as never });

/**
 * Publishes an entry the filter matches, then holds the editor's change to
 * it as a draft; answers the entry's id.
 */
async function heldDraft(t: TestNextly, collection: string): Promise<string> {
  const created = await t.nextly.create({
    collection,
    data: { body: "live", team: "public", status: "published" },
  });
  const id = String((created.item as { id: string | number }).id);
  await as(EDITOR).update({
    collection,
    id,
    data: { body: "finished draft" },
  } as never);
  return id;
}

/** What the publisher reads of the entry, asking for its pending change. */
const readAsPublisher = (collection: string, id: string) =>
  as(PUBLISHER).findByID({ collection, id, draft: true } as never) as Promise<
    Record<string, unknown>
  >;

describe("a publisher whose read is limited to a read rule's filter", () => {
  it("is shown the live entry, not its pending change", async () => {
    const t = await boot();
    const id = await heldDraft(t, FILTERED);
    const read = await readAsPublisher(FILTERED, id);
    expect(read.body).toBe("live");
    expect(read._isWorkingDraft).toBeUndefined();
  });

  it("is shown the pending change where no read rule limits them", async () => {
    // The control: the same publisher, on a collection with no read rule,
    // reads the draft, so the case above is the filter withholding it.
    const t = await boot();
    const id = await heldDraft(t, OPEN);
    const read = await readAsPublisher(OPEN, id);
    expect(read.body).toBe("finished draft");
    expect(read._isWorkingDraft).toBe(true);
  });
});
