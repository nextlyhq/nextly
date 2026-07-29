/**
 * Populating a relationship asks the TARGET collection whether this caller may
 * read it.
 *
 * A related row belongs to another collection and carries that collection's own
 * read rules. Expansion selected it straight from its table and applied only
 * field-level redaction, so a caller refused the collection outright still
 * obtained its rows by populating a relationship that pointed at them — the
 * write-up and the probe are in tasks/left-tasks/081.
 *
 * The refusal reads as an ABSENT relationship rather than an error: one
 * unreadable reference must not refuse the whole parent read, and the caller
 * learns no more than a reference pointing at nothing would tell them.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
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

const RULE_PATH = new URL("./_fixtures/tenant-read-rule.ts", import.meta.url)
  .pathname;

/**
 * `refs` points at the same restricted row twice: once through a field naming
 * several collections, once through an ordinary single-target field. The
 * single-target one is the control — the gap was never specific to multi-target
 * references, and a fix that closed only those would leave the same row
 * reachable through the field beside it.
 */
async function boot(): Promise<{
  handler: CollectionsHandler;
  refId: string;
  pageId: string;
}> {
  current = await createTestNextly({
    collections: [
      defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      defineCollection({
        slug: "pages",
        fields: [text({ name: "title" }), text({ name: "tenant" })],
      }),
      defineCollection({
        slug: "refs",
        fields: [
          text({ name: "name" }),
          relationship({ name: "target", relationTo: ["posts", "pages"] }),
          relationship({ name: "plain", relationTo: "pages" }),
        ],
      }),
    ],
  });

  const handler = current.getService<CollectionsHandler>("collectionsHandler");
  const page = await handler.createEntry(
    { collectionName: "pages", overrideAccess: true },
    { title: "Restricted page", tenant: "acme" }
  );
  const pageId = (page.data as { id: string }).id;
  const ref = await handler.createEntry(
    { collectionName: "refs", overrideAccess: true },
    {
      name: "r",
      target: { relationTo: "pages", value: pageId },
      plain: pageId,
    }
  );

  // `claim-aware` without a matching tenant claim is refused outright.
  await current.adapter.update(
    "dynamic_collections",
    { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
    { and: [{ column: "slug", op: "=", value: "pages" }] }
  );

  return { handler, refId: (ref.data as { id: string }).id, pageId };
}

describe("related-row collection access (integration)", () => {
  it("does not populate a target the caller may not read", async () => {
    const { handler, refId, pageId } = await boot();

    // The same caller, reading the target directly, is refused.
    const direct = await handler.getEntry({
      collectionName: "pages",
      entryId: pageId,
      user: { id: "claim-aware" },
      routeAuthorized: true,
    });
    expect(direct.success).toBe(false);
    expect(direct.statusCode).toBe(403);

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      user: { id: "claim-aware" },
      routeAuthorized: true,
    });

    // The parent read is still served.
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;

    // Neither shape hands back the row the direct read refused.
    expect(JSON.stringify(data.target ?? null)).not.toContain(
      "Restricted page"
    );
    expect(JSON.stringify(data.plain ?? null)).not.toContain("Restricted page");
  });

  // The mirror, and the reason the case above is not enough on its own:
  // enforcing without a threaded caller judges everyone anonymous and hides
  // the row from callers the rule admits, which no leak test would catch.
  it("still populates the target for a caller the rule admits", async () => {
    const { handler, refId } = await boot();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      // The fixture returns `true` for any other caller.
      user: { id: "permitted" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.target)).toContain("Restricted page");
    expect(JSON.stringify(data.plain)).toContain("Restricted page");
  });

  it("leaves a trusted read unfiltered", async () => {
    const { handler, refId } = await boot();

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: refId,
      depth: 1,
      overrideAccess: true,
    });

    const data = result.data as Record<string, unknown>;
    expect(JSON.stringify(data.target)).toContain("Restricted page");
    expect(JSON.stringify(data.plain)).toContain("Restricted page");
  });
});
