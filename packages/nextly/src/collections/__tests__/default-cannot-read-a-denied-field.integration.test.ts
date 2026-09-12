/**
 * A function default is evaluated on what the caller was ALLOWED to send.
 *
 * Function defaults receive the data built so far. They ran before field write
 * access, so a field this caller may not create was still in the record while
 * they ran: a default could read the forbidden value and carry it into a field
 * the caller IS allowed to write. The denied field was stripped from the
 * record and its value was persisted anyway, one column across, which is the
 * field rule defeated by proxy.
 *
 * Write access now runs before the defaults as well as after the hooks, the
 * two passes the read path runs for the same reason: the first decides what
 * the caller may put in, the second catches a denied key a hook put back.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const CALLER = { id: "u1", email: "u@x.test", roles: [] };

async function boot() {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "leaky",
        fields: [
          text({ name: "title" }),
          text({ name: "secret", access: { create: () => false } }),
          text({
            name: "derived",
            defaultValue: d => `saw:${String(d.secret)}`,
          }),
          text({ name: "open" }),
          text({
            name: "fromOpen",
            defaultValue: d => `saw:${String(d.open)}`,
          }),
        ],
      }),
    ],
  });
  return current.getService<"collectionsHandler">("collectionsHandler");
}

describe("a function default cannot read a field the caller may not write", () => {
  it("evaluates on the authorized record, not the raw request", async () => {
    const handler = (await boot()) as unknown as CollectionsHandler;

    const created = await handler.createEntry(
      {
        collectionName: "leaky",
        // The route gate has run; the FIELD rules are the ones under test.
        routeAuthorized: true,
        user: CALLER,
      },
      { title: "t", secret: "forbidden-value", open: "fine" }
    );

    expect(created.success, JSON.stringify(created)).toBe(true);
    const row = created.data as Record<string, unknown>;
    // The denied field is stripped, as it always was.
    expect(row.secret ?? null).toBeNull();
    // And its value did not reach the database through the default either.
    expect(row.derived).not.toContain("forbidden-value");
    expect(row.derived).toBe("saw:undefined");
    // A default reading an ALLOWED field still sees it: the pass removes what
    // the caller may not send, not everything they sent.
    expect(row.fromOpen).toBe("saw:fine");
  });

  it("still lets a trusted caller's default read the field", async () => {
    const handler = (await boot()) as unknown as CollectionsHandler;

    const created = await handler.createEntry(
      { collectionName: "leaky", overrideAccess: true },
      { title: "t", secret: "system-value", open: "fine" }
    );

    expect(created.success, JSON.stringify(created)).toBe(true);
    const row = created.data as Record<string, unknown>;
    // `overrideAccess` means the field rules do not apply, so the value is
    // both stored and visible to the default.
    expect(row.secret).toBe("system-value");
    expect(row.derived).toBe("saw:system-value");
  });
  it("keeps a value whose permission a DEFAULT establishes", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "gated",
          fields: [
            text({ name: "title" }),
            text({ name: "kind", defaultValue: "public" }),
            text({
              name: "note",
              access: {
                create: ({ data }) =>
                  (data as { kind?: string } | undefined)?.kind === "public",
              },
            }),
          ],
        }),
      ],
    });
    const handler = current.getService<"collectionsHandler">(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;

    const created = await handler.createEntry(
      { collectionName: "gated", routeAuthorized: true, user: CALLER },
      // `kind` is omitted on purpose: its default is what satisfies the rule
      // guarding `note`.
      { title: "t", note: "should survive" }
    );

    expect(created.success, JSON.stringify(created)).toBe(true);
    const row = created.data as Record<string, unknown>;
    expect(row.kind).toBe("public");
    // The rules that decide what is STORED run after the defaults, so the
    // value the caller sent is still there to be allowed.
    expect(row.note).toBe("should survive");
  });
});
