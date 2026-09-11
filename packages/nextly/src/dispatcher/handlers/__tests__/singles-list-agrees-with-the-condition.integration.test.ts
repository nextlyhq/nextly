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

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { runWithCallerScope } from "../../../auth/caller-scope";
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
      defineSingle({
        slug: "editors-only",
        // Decides on the caller's ROLES. For an API key those must be the
        // key's own, which the list request's params never carry.
        access: {
          read: ({ roles }) => roles.includes("editor"),
          update: () => false,
        },
        fields: [text({ name: "memo" })],
      }),
      defineSingle({
        slug: "spelled-out",
        // Decides on the documented `resource:action` spelling. A key handed
        // its stored slugs (`read-spelled-out`) is refused here.
        access: {
          read: ({ permissions }) => permissions.includes("spelled-out:read"),
          update: () => false,
        },
        fields: [text({ name: "body" })],
      }),
    ],
  });
}

/** An API key holding read grants on the two rule-bearing Singles, and the editor role. */
const KEY_GRANTS = [
  { slug: "read-editors-only", resource: "editors-only", action: "read" },
  { slug: "read-spelled-out", resource: "spelled-out", action: "read" },
];
const KEY_OWNER = "key-owner";
const keyScope = () => apiKeyScope(KEY_GRANTS, ["editor"]);

async function conditionHolds(): Promise<boolean> {
  const verdicts = await evaluateConditions(
    new Set(["singles:present"]),
    reader
  );
  return verdicts.get("singles:present") === true;
}

async function listedSlugs(
  params: Record<string, string> = { _authenticatedUserId: READER_ID }
): Promise<string[]> {
  const response = (await dispatchSingles(
    "listSingles",
    params,
    undefined
  )) as Response;
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: Array<{ slug: string }> };
  return body.items.map(item => item.slug).sort();
}

/** The listing as the route handler serves an API key: scope pinned for the dispatch. */
function listedForKey(): Promise<string[]> {
  return runWithCallerScope(keyScope(), () =>
    listedSlugs({
      _authenticatedUserId: KEY_OWNER,
      _authenticatedActorType: "apiKey",
    })
  );
}

async function conditionHoldsForKey(scope = keyScope()): Promise<boolean> {
  const verdicts = await evaluateConditions(new Set(["singles:present"]), {
    user: { id: KEY_OWNER, roles: ["admin"] },
    authenticatedScope: scope,
  });
  return verdicts.get("singles:present") === true;
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

describe("an API key, asked the same two ways", () => {
  it("is admitted by a rule on its OWN roles, on the listing and the condition alike", async () => {
    // 🔴 The listing's params never carry the key's roles, and the user on
    // them is the key's OWNER (an admin here, not an editor). Rebuilt from the
    // params the key was refused; read from the pinned scope it is not.
    await boot();
    expect(await listedForKey()).toContain("editors-only");
    expect(await conditionHoldsForKey()).toBe(true);
  });

  it("is admitted by a rule written to the documented permission spelling", async () => {
    // 🔴 The key holds `read-spelled-out`; the rule checks
    // `spelled-out:read`, which is what the context promises. Handed the
    // stored spelling, the rule refused a correctly scoped key.
    await boot();
    expect(await listedForKey()).toContain("spelled-out");
    // The condition's own builder, given a key holding ONLY this grant and
    // no role: it can hold only if that builder spells the grant the way the
    // rule reads it.
    expect(
      await conditionHoldsForKey(
        apiKeyScope([
          { slug: "read-spelled-out", resource: "spelled-out", action: "read" },
        ])
      )
    ).toBe(true);
  });

  it("is still refused what its grants do not name", async () => {
    // The control: the key holds no grant on `homepage`, and a key is judged
    // on its own scope even though a code rule admits everyone else.
    await boot();
    expect(await listedForKey()).not.toContain("homepage");
  });
});
