/**
 * Storage round-trip for the blocks field.
 *
 * A page document is a nested tree stored as one JSON value, so the risk this
 * suite covers is per-dialect: Postgres stores `jsonb`, MySQL `json`, and
 * SQLite `text`, and each has its own parse-on-read behaviour. A document that
 * comes back as a string, or with its nesting flattened, would break every
 * renderer downstream while every unit test still passed.
 *
 * The suite self-skips on dialects whose URL is unset, per the integration
 * convention; CI runs all three.
 */
import { afterEach, describe, expect, it } from "vitest";

import { blocks, defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A document with nesting, styles, and slots — not a flat list of nodes. */
const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      type: "core/section",
      version: 1,
      props: { width: "wide" },
      styles: { base: { base: { paddingBlockStart: "2rem" } } },
      slots: {
        default: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            type: "core/heading",
            version: 1,
            props: { text: "Hello", level: 2 },
          },
        ],
      },
    },
  ],
};

/** The created entry's id, from the handler's result envelope. */
function idOf(result: unknown): string {
  const data = (result as { data?: { id?: unknown } }).data;
  if (typeof data?.id !== "string") {
    throw new Error(`create did not return an id: ${JSON.stringify(result)}`);
  }
  return data.id;
}

/** The read entry's fields, from the handler's result envelope. */
function dataOf(result: unknown): Record<string, unknown> {
  const data = (result as { data?: unknown }).data;
  return (data ?? {}) as Record<string, unknown>;
}

async function handlerFor(): Promise<CollectionsHandler> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        fields: [text({ name: "title" }), blocks({ name: "content" })],
      }),
    ],
  });
  return current.getService<CollectionsHandler>("collectionsHandler");
}

describe("blocks field storage (integration)", () => {
  it("round-trips a nested document unchanged", async () => {
    const handler = await handlerFor();

    const created = await handler.createEntry(
      { collectionName: "pages", userId: "u1", overrideAccess: true },
      { title: "Home", content: DOCUMENT }
    );

    const read = await handler.getEntry({
      collectionName: "pages",
      entryId: idOf(created),
      overrideAccess: true,
    });

    // Deep equality, not a shape check: nesting, slots, and style values must
    // all survive the dialect's own JSON handling.
    expect(dataOf(read).content).toEqual(DOCUMENT);
  });

  it("reads the document back as an object, never a JSON string", async () => {
    const handler = await handlerFor();
    const created = await handler.createEntry(
      { collectionName: "pages", userId: "u1", overrideAccess: true },
      { title: "Home", content: DOCUMENT }
    );

    const content = dataOf(
      await handler.getEntry({
        collectionName: "pages",
        entryId: idOf(created),
        overrideAccess: true,
      })
    ).content;

    // SQLite stores JSON as text; a missing parse would surface here and
    // nowhere else.
    expect(typeof content).toBe("object");
    expect(Array.isArray((content as { nodes: unknown[] }).nodes)).toBe(true);
  });

  it("updates a document in place", async () => {
    const handler = await handlerFor();
    const created = await handler.createEntry(
      { collectionName: "pages", userId: "u1", overrideAccess: true },
      { title: "Home", content: DOCUMENT }
    );

    const emptied = { formatVersion: 1, kind: "page", nodes: [] };
    await handler.updateEntry(
      {
        collectionName: "pages",
        entryId: idOf(created),
        userId: "u1",
        overrideAccess: true,
      },
      { content: emptied }
    );

    const read = await handler.getEntry({
      collectionName: "pages",
      entryId: idOf(created),
      overrideAccess: true,
    });
    expect(dataOf(read).content).toEqual(emptied);
  });

  it("stores an absent document as null rather than inventing one", async () => {
    const handler = await handlerFor();
    const created = await handler.createEntry(
      { collectionName: "pages", userId: "u1", overrideAccess: true },
      { title: "No content" }
    );

    const read = await handler.getEntry({
      collectionName: "pages",
      entryId: idOf(created),
      overrideAccess: true,
    });
    expect(dataOf(read).content ?? null).toBeNull();
  });

  it("refuses a document the field does not accept", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          fields: [
            text({ name: "title" }),
            blocks({ name: "content", blocks: { allow: ["core/*"] } }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const result = (await handler.createEntry(
      { collectionName: "pages", userId: "u1", overrideAccess: true },
      {
        title: "Home",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              type: "acme/pricing",
              version: 1,
              props: {},
            },
          ],
        },
      }
    )) as {
      success: boolean;
      committed: boolean;
      errors?: Array<{ code: string; path: string }>;
    };

    expect(result.success).toBe(false);
    // Nothing is written when the document is refused.
    expect(result.committed).toBe(false);
    expect(result.errors?.map(issue => issue.code)).toEqual([
      "DISALLOWED_BLOCK_TYPE",
    ]);
    expect(result.errors?.[0]?.path).toBe("content");
  });
});
