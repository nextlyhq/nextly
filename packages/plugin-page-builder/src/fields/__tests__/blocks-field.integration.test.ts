/**
 * Storage round-trip for the blocks field.
 *
 * A page document is a nested tree stored as one JSON value, so the risk this
 * suite covers is per-dialect: Postgres stores `jsonb`, MySQL `json`, and
 * SQLite `text`, and each has its own parse-on-read behaviour. A document that
 * comes back as a string, or with its nesting flattened, would break every
 * renderer downstream while every unit test still passed.
 *
 * That is the risk it was written for, and until now it did not cover it: the
 * suite booted the harness with no dialect, which is in-memory SQLite, so the
 * two dialects whose JSON handling differs were never exercised. It now runs
 * once per dialect the machine can reach.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../../plugin";
import { blocks } from "../blocksHelper";

/** Only what this suite calls, so it does not reach into core's private types. */
interface CollectionsHandler {
  createEntry(
    ctx: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  updateEntry(
    ctx: Record<string, unknown>,
    id: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  getEntry(
    ctx: Record<string, unknown>,
    id: string
  ): Promise<Record<string, unknown>>;
}

interface SingleEntryService {
  update(
    slug: string,
    data: Record<string, unknown>,
    ctx?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  get(
    slug: string,
    ctx?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
}

/** Every dialect the harness supports, so an unreachable one is skipped visibly. */
// `postgresql` is the token `TestDialect` declares; the harness matches on it
// exactly. Spelled `postgres` the leg matched nothing and silently never ran,
// so this suite reported a coverage it did not have.
const ALL_DIALECTS: readonly TestDialect[] = ["sqlite", "postgresql", "mysql"];

/**
 * One describe per dialect, skipped rather than dropped when the server is not
 * reachable: silently omitting a dialect is how this suite came to claim
 * coverage it did not have.
 */
function describeEachDialect(
  title: string,
  body: (dialect: TestDialect) => void
): void {
  const available = new Set(getConfiguredTestDialects());
  for (const dialect of ALL_DIALECTS) {
    const name = `${title} (${dialect})`;
    if (available.has(dialect)) describe(name, () => body(dialect));
    else describe.skip(name, () => body(dialect));
  }
}

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
  // Asserted rather than thrown: a failed create then reports what came back
  // instead of surfacing as an unrelated error from the helper.
  expect(typeof data?.id, JSON.stringify(result)).toBe("string");
  return String(data?.id);
}

/** The read entry's fields, from the handler's result envelope. */
function dataOf(result: unknown): Record<string, unknown> {
  const data = (result as { data?: unknown }).data;
  return (data ?? {}) as Record<string, unknown>;
}

async function handlerFor(dialect: TestDialect): Promise<CollectionsHandler> {
  current = await createTestNextly({
    dialect,
    // Installed so the field type is registered before the schema is built.
    // `defineCollection` accepts the token because it defers an unrecognised
    // one to boot rather than refusing it, which is what makes a contributed
    // field declarable from code at all.
    plugins: [pageBuilder()],
    collections: [
      defineCollection({
        slug: "docs",
        fields: [text({ name: "title" }), blocks({ name: "content" })],
      }),
    ],
  });
  return current.getService<CollectionsHandler>("collectionsHandler");
}

describeEachDialect("blocks field storage", dialect => {
  it("round-trips a nested document unchanged", async () => {
    const handler = await handlerFor(dialect);

    const created = await handler.createEntry(
      { collectionName: "docs", userId: "u1", overrideAccess: true },
      { title: "Home", content: DOCUMENT }
    );

    const read = await handler.getEntry({
      collectionName: "docs",
      entryId: idOf(created),
      overrideAccess: true,
    });

    // Deep equality, not a shape check: nesting, slots, and style values must
    // all survive the dialect's own JSON handling.
    expect(dataOf(read).content).toEqual(DOCUMENT);
  });

  it("reads the document back as an object, never a JSON string", async () => {
    const handler = await handlerFor(dialect);
    const created = await handler.createEntry(
      { collectionName: "docs", userId: "u1", overrideAccess: true },
      { title: "Home", content: DOCUMENT }
    );

    const content = dataOf(
      await handler.getEntry({
        collectionName: "docs",
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
    const handler = await handlerFor(dialect);
    const created = await handler.createEntry(
      { collectionName: "docs", userId: "u1", overrideAccess: true },
      { title: "Home", content: DOCUMENT }
    );

    const emptied = { formatVersion: 1, kind: "page", nodes: [] };
    await handler.updateEntry(
      {
        collectionName: "docs",
        entryId: idOf(created),
        userId: "u1",
        overrideAccess: true,
      },
      { content: emptied }
    );

    const read = await handler.getEntry({
      collectionName: "docs",
      entryId: idOf(created),
      overrideAccess: true,
    });
    expect(dataOf(read).content).toEqual(emptied);
  });

  it("stores an absent document as null rather than inventing one", async () => {
    const handler = await handlerFor(dialect);
    const created = await handler.createEntry(
      { collectionName: "docs", userId: "u1", overrideAccess: true },
      { title: "No content" }
    );

    const read = await handler.getEntry({
      collectionName: "docs",
      entryId: idOf(created),
      overrideAccess: true,
    });
    expect(dataOf(read).content ?? null).toBeNull();
  });

  it("round-trips a document on a single, not just a collection", async () => {
    // Singles have their own JSON classifier and their own serialize/
    // deserialize pair, so a collection round-trip proves nothing about them.
    current = await createTestNextly({
      dialect,
      plugins: [pageBuilder()],
      singles: [
        {
          slug: "homepage",
          fields: [
            text({ name: "title" }),
            { name: "content", type: "blocks" },
          ],
        },
      ] as never,
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    const written = await singles.update(
      "homepage",
      { title: "Home", content: DOCUMENT },
      { overrideAccess: true }
    );
    expect((written as { success?: boolean }).success).toBe(true);

    const read = await singles.get("homepage", { overrideAccess: true });
    expect(dataOf(read).content).toEqual(DOCUMENT);
  });

  it("refuses a document the field does not accept", async () => {
    current = await createTestNextly({
      dialect,
      plugins: [pageBuilder()],
      collections: [
        defineCollection({
          slug: "docs",
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
      { collectionName: "docs", userId: "u1", overrideAccess: true },
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
