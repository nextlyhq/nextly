/**
 * A document is judged by the status the write leaves it in.
 *
 * The engine sorts document problems into two kinds: structural corruption,
 * which is always an error, and preservable-but-unknown, whose severity follows
 * the validation mode. Duplicate HTML ids are the second kind — the document is
 * intact and an editor can keep working, but the rendered page emits the same
 * `id` twice, breaking anchors, labels, and CSS selectors.
 *
 * So a draft may hold one and a publish may not, and that difference is only
 * reachable if the write path tells the field which it is. These assert the
 * whole path: the mutation service resolves the status, forwards it on `req`,
 * and the field type turns it into a mode.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../../plugin";
import { blocks } from "../blocksHelper";

/**
 * The id of an entry a setup step created, asserting the create succeeded
 * first. Without the assertion a failed setup surfaces later as a 404 from the
 * write under test, which reads as the feature being broken.
 */
function createdId(result: Record<string, unknown>): string {
  expect(result.success, JSON.stringify(result)).not.toBe(false);
  const id = (result.data as { id?: unknown } | null)?.id;
  expect(typeof id, JSON.stringify(result)).toBe("string");
  return String(id);
}

/** The issue codes a refused write reports, or an empty list when it succeeded. */
function refusalCodes(result: Record<string, unknown>): string[] {
  if (result.success !== false) return [];
  const errors = result.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map(issue => (issue as { code?: unknown }).code)
    .filter((code): code is string => typeof code === "string");
}

/** Only what this suite calls, so it does not reach into core's private types. */
interface CollectionsHandler {
  createEntry(
    ctx: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  updateEntry(
    ctx: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * Two nodes carrying the same `cssId`. Structurally sound — every id, type and
 * version is well formed — so nothing here is an error in either mode except
 * the repeated DOM id.
 */
const DUPLICATE_DOM_ID = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      type: "core/heading",
      version: 1,
      cssId: "hero",
      props: { text: "First", level: 2 },
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      type: "core/heading",
      version: 1,
      cssId: "hero",
      props: { text: "Second", level: 2 },
    },
  ],
};

async function handlerWithStatus(): Promise<CollectionsHandler> {
  current = await createTestNextly({
    plugins: [pageBuilder()],
    collections: [
      defineCollection({
        slug: "articles",
        status: true,
        fields: [text({ name: "title" }), blocks({ name: "content" })],
      }),
    ],
  });
  return current.getService<CollectionsHandler>("collectionsHandler");
}

describe("a blocks document is judged by the status the write leaves it in", () => {
  it("accepts a draft holding duplicate HTML ids", async () => {
    const handler = await handlerWithStatus();

    const created = await handler.createEntry(
      { collectionName: "articles", overrideAccess: true },
      { title: "Draft", status: "draft", content: DUPLICATE_DOM_ID }
    );

    expect(refusalCodes(created), JSON.stringify(created)).toEqual([]);
  });

  it("refuses to publish a document holding duplicate HTML ids", async () => {
    const handler = await handlerWithStatus();

    const refused = await handler.createEntry(
      { collectionName: "articles", overrideAccess: true },
      { title: "Live", status: "published", content: DUPLICATE_DOM_ID }
    );

    expect(refusalCodes(refused), JSON.stringify(refused)).toContain(
      "duplicate-dom-id"
    );
  });

  it("does NOT yet catch a publish that changes only the status", async () => {
    // A characterization test, not an endorsement. Validation runs on the
    // PATCH, and a publish sent as `{ status: "published" }` carries no
    // `content` key — so the field's validator is never invoked and the stored
    // document goes live unchecked. Closing this means a publish validating the
    // resulting ENTRY rather than the patch, which changes what every field
    // type sees on a status-only write and would surface data stored before a
    // rule existed. That belongs in its own change; this pins the current
    // behaviour so it cannot shift unnoticed, and fails the moment it is fixed.
    const handler = await handlerWithStatus();

    const created = await handler.createEntry(
      { collectionName: "articles", overrideAccess: true },
      { title: "Draft", status: "draft", content: DUPLICATE_DOM_ID }
    );
    const id = createdId(created);

    const published = await handler.updateEntry(
      { collectionName: "articles", entryId: id, overrideAccess: true },
      { status: "published" }
    );

    expect(refusalCodes(published), JSON.stringify(published)).toEqual([]);
  });

  it("refuses an edit to a live entry that never mentions status", async () => {
    // The case the stored-status half of the resolution exists for. The write
    // names no status, so judging it on the payload alone would read it as a
    // draft and let a broken document reach a published page.
    const handler = await handlerWithStatus();

    const created = await handler.createEntry(
      { collectionName: "articles", overrideAccess: true },
      {
        title: "Live",
        status: "published",
        content: { formatVersion: 1, kind: "page", nodes: [] },
      }
    );
    const id = createdId(created);

    const refused = await handler.updateEntry(
      { collectionName: "articles", entryId: id, overrideAccess: true },
      { content: DUPLICATE_DOM_ID }
    );

    expect(refusalCodes(refused), JSON.stringify(refused)).toContain(
      "duplicate-dom-id"
    );
  });

  it("accepts the same document on a collection with no publish lifecycle", async () => {
    // No lifecycle means no published state to hold content to, so the
    // stricter reading never applies and behaviour is exactly as before.
    current = await createTestNextly({
      plugins: [pageBuilder()],
      collections: [
        defineCollection({
          slug: "notes",
          fields: [text({ name: "title" }), blocks({ name: "content" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "notes", overrideAccess: true },
      { title: "Note", content: DUPLICATE_DOM_ID }
    );

    expect(refusalCodes(created), JSON.stringify(created)).toEqual([]);
  });
});
