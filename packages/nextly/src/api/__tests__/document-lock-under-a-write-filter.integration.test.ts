/**
 * A document lock under an update rule that answers a filter: an editor
 * holding a claim on an entry may give it up again.
 *
 * Releasing asks whether the caller holds the update permission, a hint of
 * what they may do, not a yes or no a write acts on. Answered as a plugin's
 * `ctx.caller.can("update")` is, refused under a filter, the release would be
 * refused while the claim stood, and the lock would stay held until its lease
 * lapsed. The claim is taken through the lock service, as a REST claim under
 * a filter is refused for now. A reader without the update permission is
 * refused the same release, so the release still asks the permission.
 *
 * @module api/__tests__/document-lock-under-a-write-filter.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { container } from "../../di/container";
import type { DocumentLockService } from "../../domains/document-lock";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const NOTES = "lock_writefilter_notes";
const EDITOR = "lock-writefilter-editor";
const READER = "lock-writefilter-reader";
const ORIGIN = "http://localhost";

/** An update rule answering `value`, unchecked by the rule type, as untyped code may. */
const answering = (value: unknown) => () => value as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<string> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: NOTES,
        access: {
          read: true,
          update: answering({ team: { equals: "public" } }),
        },
        fields: [text({ name: "title" }), text({ name: "team" })],
      }),
    ],
  });
  current = t;
  // The rule narrows the update permission, so the editor holds it.
  await userWhoMay(t, EDITOR, "update", [NOTES]);
  await grantTo(t, EDITOR, "read", [NOTES]);
  await userWhoMay(t, READER, "read", [NOTES]);
  const created = await t.nextly.create({
    collection: NOTES,
    data: { title: "public", team: "public" },
  });
  return String((created.item as { id: string | number }).id);
}

/** A claim on `id` held by `owner`, taken through the lock service. */
async function claimedBy(owner: string, id: string): Promise<string> {
  const outcome = await container
    .get<DocumentLockService>("documentLockService")
    .acquire(
      { scopeKind: "collection", slug: NOTES, entryId: id },
      { ownerId: owner, ownerLabel: owner }
    );
  if (outcome.status !== "acquired") throw new Error("the claim was not taken");
  return outcome.claimToken;
}

/** `who`'s REST release of `id`'s lock: its status. */
async function released(
  who: string,
  id: string,
  claimToken: string
): Promise<number> {
  const token = await signAccessToken(
    buildClaims({
      userId: who,
      email: `${who}@example.test`,
      name: who,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  const segments = ["document-lock"];
  const res = await createDynamicHandlers().DELETE(
    new Request(`${ORIGIN}/api/${segments.join("/")}`, {
      method: "DELETE",
      headers: {
        origin: ORIGIN,
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scopeKind: "collection",
        slug: NOTES,
        entryId: id,
        claimToken,
      }),
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  return res.status;
}

describe("a document lock under an update rule that answers a filter", () => {
  it("lets the editor holding a claim give it up", async () => {
    const id = await boot();
    expect(await released(EDITOR, id, await claimedBy(EDITOR, id))).toBe(200);
  });

  it("refuses the same release to a reader without the update permission", async () => {
    const id = await boot();
    expect(await released(READER, id, await claimedBy(READER, id))).toBe(403);
  });
});
