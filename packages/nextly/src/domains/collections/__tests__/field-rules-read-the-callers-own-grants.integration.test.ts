/**
 * A collection's field rules are judged on the authority the CALLER arrived
 * with.
 *
 * A field `access` rule receives `permissions` and `roles` and is asking about
 * the caller. An API key carries the grants stamped on the key, which are
 * deliberately narrower than the database roles of whoever owns it: that is the
 * whole point of scoping a key. The collection write paths did not pass the
 * caller's scope to the field pass, so those rules were answered from the key
 * owner's roles instead.
 *
 * It reads as a permission bug in both directions. A key stamped with the grant
 * a rule asks for could not write the field, and the write reported success
 * while dropping the value; and a key owned by a privileged user is judged on
 * authority the key was never given.
 *
 * @module domains/collections/__tests__/field-rules-read-the-callers-own-grants.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "keyscoped";

async function boot(): Promise<CollectionsHandler> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: SLUG,
        access: { read: () => true, update: () => true, create: () => true },
        fields: [
          text({ name: "body" }),
          text({
            name: "secret",
            access: {
              update: ({ permissions }) =>
                (permissions as string[]).includes("write-secret"),
              create: ({ permissions }) =>
                (permissions as string[]).includes("write-secret"),
            },
          }),
        ],
      }),
    ],
  });
  return current.getService("collectionsHandler") as CollectionsHandler;
}

async function read(id: string): Promise<Record<string, unknown>> {
  const doc = (await current!.nextly.findByID({
    collection: SLUG as never,
    id,
    overrideAccess: true,
  } as never)) as Record<string, unknown> | null;
  return doc ?? {};
}

const KEY_WITH_GRANT = {
  actorType: "apiKey" as const,
  permissions: [`update-${SLUG}`, `create-${SLUG}`, "write-secret"],
};
const KEY_WITHOUT_GRANT = {
  actorType: "apiKey" as const,
  permissions: [`update-${SLUG}`, `create-${SLUG}`],
};

describe("a collection field rule reads the caller's own grants", () => {
  it("lets an API key write a field its own scope grants", async () => {
    const h = await boot();
    const created = await h.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { body: "b", secret: "before" }
    );
    const id = (created.data as { id?: string }).id as string;

    const updated = await h.updateEntry(
      {
        collectionName: SLUG,
        entryId: id,
        routeAuthorized: true,
        user: { id: "key-owner" },
        authenticatedScope: KEY_WITH_GRANT,
      } as never,
      { body: "b2", secret: "after" }
    );

    expect(updated.success, JSON.stringify(updated)).toBe(true);
    const doc = await read(id);
    expect(doc.body).toBe("b2");
    // Judged on the key owner's database roles instead, the rule sees no
    // permissions at all: the value is dropped in silence and the call still
    // reports success, so a correctly scoped key cannot write its own field.
    expect(doc.secret).toBe("after");
  });

  it("still refuses a key whose scope does NOT grant it", async () => {
    const h = await boot();
    const created = await h.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { body: "b", secret: "before" }
    );
    const id = (created.data as { id?: string }).id as string;

    const updated = await h.updateEntry(
      {
        collectionName: SLUG,
        entryId: id,
        routeAuthorized: true,
        user: { id: "key-owner" },
        authenticatedScope: KEY_WITHOUT_GRANT,
      } as never,
      { body: "b2", secret: "after" }
    );

    // The control for the test above: passing the scope through must not mean
    // passing everything. Stripped, as a denied field is on any ordinary write.
    expect(updated.success, JSON.stringify(updated)).toBe(true);
    const doc = await read(id);
    expect(doc.body).toBe("b2");
    expect(doc.secret).toBe("before");
  });

  it("reads the key's grants on a create as well as an update", async () => {
    const h = await boot();

    const created = await h.createEntry(
      {
        collectionName: SLUG,
        routeAuthorized: true,
        user: { id: "key-owner" },
        authenticatedScope: KEY_WITH_GRANT,
      } as never,
      { body: "b", secret: "seeded" }
    );

    expect(created.success, JSON.stringify(created)).toBe(true);
    const doc = await read((created.data as { id?: string }).id as string);
    expect(doc.secret).toBe("seeded");
  });
});
