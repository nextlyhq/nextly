/**
 * Declared defaults on a collection create, through the real write path.
 *
 * `defaultValue` was honoured only by the admin form (in the browser) and by a
 * single's auto-create, so an entry written through the REST or Direct API
 * stored nothing for an omitted field — and a REQUIRED field carrying a
 * default could not be created at all, because validation saw an absent value.
 * A unit test over the helper cannot show either, since both depend on where
 * the helper sits relative to validation and the insert.
 *
 * The suite self-skips on dialects whose URL is unset, per the integration
 * convention; CI runs all three.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  blocks,
  checkbox,
  defineCollection,
  group,
  number,
  repeater,
  text,
} from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const EMPTY_DOC = { formatVersion: 1, kind: "page", nodes: [] };

async function handlerFor(): Promise<CollectionsHandler> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        fields: [
          text({ name: "title" }),
          text({ name: "subtitle", defaultValue: "from-default" }),
          text({ name: "mandatory", required: true, defaultValue: "filled" }),
          text({ name: "derived", defaultValue: d => `re: ${d.title}` }),
          number({ name: "rank", defaultValue: 7 }),
          checkbox({ name: "featured", defaultValue: true }),
          blocks({ name: "content", defaultValue: EMPTY_DOC }),
          group({
            name: "seo",
            fields: [
              text({ name: "metaTitle", required: true, defaultValue: "mt" }),
              text({ name: "metaDesc", defaultValue: "md" }),
            ],
          }),
          repeater({
            name: "items",
            fields: [text({ name: "label", defaultValue: "dl" })],
          }),
        ],
      }),
    ],
  });
  return current.getService<CollectionsHandler>("collectionsHandler");
}

async function createAndRead(
  handler: CollectionsHandler,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const created = await handler.createEntry(
    { collectionName: "pages", userId: "u1", overrideAccess: true },
    input
  );
  const id = (created as { data?: { id?: unknown } }).data?.id;
  expect(typeof id, JSON.stringify(created)).toBe("string");
  const read = await handler.getEntry({
    collectionName: "pages",
    entryId: String(id),
    overrideAccess: true,
  });
  return ((read as { data?: unknown }).data ?? {}) as Record<string, unknown>;
}

describe("field defaults on a collection create (integration)", () => {
  it("applies a declared default for every omitted field", async () => {
    const handler = await handlerFor();
    const data = await createAndRead(handler, { title: "Home" });

    expect(data.subtitle).toBe("from-default");
    expect(data.rank).toBe(7);
    expect(data.featured).toBe(true);
    // A JSON-backed default reaches storage as a document, not a string.
    expect(data.content).toEqual(EMPTY_DOC);
  });

  it("satisfies a required field that carries a default", async () => {
    // Previously impossible: the create was rejected with REQUIRED because the
    // default was never resolved before validation ran.
    const handler = await handlerFor();
    const data = await createAndRead(handler, { title: "Home" });
    expect(data.mandatory).toBe("filled");
  });

  it("leaves a function default unapplied, since it cannot be stored", async () => {
    // A collection's fields reach the write path from its stored definition,
    // and a function does not survive being stored, so by then the field looks
    // as though no default was declared. Asserted rather than left implicit so
    // the boundary is visible and a future change to it is deliberate.
    const handler = await handlerFor();
    const data = await createAndRead(handler, { title: "Home" });
    expect(data.derived).toBeNull();
  });

  it("fills a group's children, including a required one", async () => {
    // Validation recurses into a group, so a required child with a default
    // was previously impossible to satisfy without sending the group.
    const handler = await handlerFor();
    const data = await createAndRead(handler, { title: "Home" });
    expect(data.seo).toEqual({ metaTitle: "mt", metaDesc: "md" });
  });

  it("fills the children of each supplied repeater row", async () => {
    const handler = await handlerFor();
    const data = await createAndRead(handler, {
      title: "Home",
      items: [{ label: "given" }, {}],
    });
    expect(data.items).toEqual([{ label: "given" }, { label: "dl" }]);
  });

  it("never overwrites a value the caller supplied", async () => {
    const handler = await handlerFor();
    const data = await createAndRead(handler, {
      title: "Home",
      subtitle: "explicit",
      rank: 0,
      featured: false,
    });

    expect(data.subtitle).toBe("explicit");
    // Falsy values are supplied values, not absent ones.
    expect(data.rank).toBe(0);
    expect(data.featured).toBe(false);
  });

  it("treats an explicit null as a decision, not an omission", async () => {
    // Null is how a JSON body says "no value"; defaulting over it would make
    // the field impossible to leave empty.
    const handler = await handlerFor();
    const data = await createAndRead(handler, {
      title: "Home",
      subtitle: null,
    });
    expect(data.subtitle).toBeNull();
  });

  it("leaves an omitted field alone on update", async () => {
    const handler = await handlerFor();
    const created = await handler.createEntry(
      { collectionName: "pages", userId: "u1", overrideAccess: true },
      { title: "Home", subtitle: "explicit" }
    );
    const id = String((created as { data?: { id?: unknown } }).data?.id);

    await handler.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        userId: "u1",
        overrideAccess: true,
      },
      { title: "Renamed" }
    );

    const read = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    const data = ((read as { data?: unknown }).data ?? {}) as Record<
      string,
      unknown
    >;
    // A default must not resurrect on every later write.
    expect(data.subtitle).toBe("explicit");
    expect(data.title).toBe("Renamed");
  });
});
