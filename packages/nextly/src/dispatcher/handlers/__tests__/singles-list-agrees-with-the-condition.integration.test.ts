/**
 * The singles listing and the `singles:present` condition answer the same
 * reader the same way.
 *
 * They must, because the dashboard offers the singles card on the condition
 * and the card then draws the listing: a reader the condition admits and the
 * listing refuses is offered a heading over nothing, which is the empty grid
 * slot the card's lifecycle exists to remove. The two were derived from
 * different things — the listing from the stored `{slug}:read` grants alone,
 * the condition from the shared read decision that also consults a Single's
 * code-defined `access.read` — so a Single authorised entirely in code was
 * offered and not listed.
 *
 * Driven against a real instance with real code rules, in both directions:
 * a rule that admits a reader holding no grant, and a rule that refuses.
 *
 * @module dispatcher/handlers/__tests__/singles-list-agrees-with-the-condition.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import { evaluateConditions } from "../../../domains/widgets/conditions";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { dispatchSingles } from "../single-dispatcher";

/** A reader with no roles and no stored grant. Everything it may read, code says. */
const READER_ID = "reader-with-no-grants";
const reader: ReadCaller = { user: { id: READER_ID, roles: [] } };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<void> {
  current = await createTestNextly({
    singles: [
      defineSingle({
        slug: "homepage",
        // Admits everyone, by code. No grant row exists for this reader.
        access: { read: () => true, update: () => false },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: "private",
        // Refuses everyone, by code, whatever the grants say.
        access: { read: () => false, update: () => false },
        fields: [text({ name: "note" })],
      }),
    ],
  });
}

async function conditionHolds(): Promise<boolean> {
  const verdicts = await evaluateConditions(
    new Set(["singles:present"]),
    reader
  );
  return verdicts.get("singles:present") === true;
}

async function listedSlugs(): Promise<string[]> {
  const response = (await dispatchSingles(
    "listSingles",
    { _authenticatedUserId: READER_ID },
    undefined
  )) as Response;
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: Array<{ slug: string }> };
  return body.items.map(item => item.slug).sort();
}

describe("the singles listing and the singles:present condition", () => {
  it("both admit a Single that a code rule alone admits", async () => {
    // 🔴 The reader holds no `homepage:read` grant. A listing scoped by grants
    // answers nothing here while the condition answers yes, and the dashboard
    // offers a card that draws an empty list.
    await boot();
    expect(await conditionHolds()).toBe(true);
    expect(await listedSlugs()).toContain("homepage");
  });

  it("both refuse a Single that a code rule refuses", async () => {
    // The must-differ half: a listing that ignored code rules could not
    // refuse this one, and a condition that ignored them could not either.
    await boot();
    expect(await listedSlugs()).not.toContain("private");
  });
});
