/**
 * A component's removed field is retired when the removal is published, and
 * its values leave every document written afterwards.
 *
 * The unit suite drives the hooks with stand-in contexts. What only a real
 * write shows is what core hands them: that a publish reaches `afterUpdate`
 * with the previous live definition and a draft save does not read as one,
 * that the strip runs before validation on a collection, a Single and a batch
 * inside its transaction, and that the retired table is read and written as
 * the system on each dialect.
 *
 * @module __tests__/retired-component-fields.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENT_RETIRED_SLUG } from "../collections/component-retired-exposures";
import { COMPONENTS_SLUG } from "../collections/components";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

type Row = Record<string, unknown>;

const NOTES = "notes";
const HOMEPAGE = "homepage";

const heading = (id: string): Row => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

/** A hero exposing the named fields, each on a heading of its own. */
const hero = (fields: string[]): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [heading("h-title"), heading("h-body")],
  exposed: fields.map(id => ({
    id,
    label: id,
    nodeId: `h-${id}`,
    propPath: "text",
    type: "text",
  })),
});

const page = (componentId: string, overrides: Row): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId, overrides },
    },
  ],
});

/** The overrides the first placement of a stored blocks value holds. */
function overridesOf(stored: unknown): unknown {
  const document = (
    typeof stored === "string" ? JSON.parse(stored) : stored
  ) as { nodes: { props: { overrides?: unknown } }[] };
  return document.nodes[0]!.props.overrides;
}

/** The batch worker, whose writes run their hooks inside its transaction. */
interface BatchEntries {
  updateEntries(
    params: { collectionName: string; overrideAccess?: boolean },
    entries: { id: string; data: Row }[]
  ): Promise<{ successful: number; failed: number }>;
}

describe.each(getConfiguredTestDialects())(
  "a component's removed fields, retired and stripped (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          {
            slug: NOTES,
            status: true,
            fields: [
              { name: "title", type: "text" },
              { name: "content", type: BLOCKS_TYPE },
            ],
          } as never,
        ],
        singles: [
          {
            slug: HOMEPAGE,
            fields: [{ name: "content", type: BLOCKS_TYPE }],
          } as never,
        ],
      });
      return current;
    }

    /** A published hero exposing `title` and `body`. */
    async function publishedHero(t: TestNextly): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Hero",
          slug: "hero",
          content: hero(["title", "body"]),
          status: "published",
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function note(t: TestNextly, componentId: string): Promise<string> {
      const created = await t.nextly.create({
        collection: NOTES,
        data: {
          title: "Note",
          content: page(componentId, { title: "Old", body: "Kept" }),
          status: "published",
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function storedNote(t: TestNextly, id: string): Promise<Row> {
      return (await t.nextly.findByID({
        collection: NOTES,
        id,
        depth: 0,
        overrideAccess: true,
      })) as Row;
    }

    async function retiredRows(t: TestNextly): Promise<Row[]> {
      const found = await t.nextly.find({
        collection: COMPONENT_RETIRED_SLUG,
        limit: 50,
        depth: 0,
        overrideAccess: true,
      });
      return found.items as Row[];
    }

    /** Publish the hero without its `title` field. */
    async function publishRemoval(t: TestNextly, id: string): Promise<void> {
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: {
          content: hero(["body"]),
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });
    }

    it("retires a field when its removal is published, and strips its value from the next write", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      const noteId = await note(t, heroId);
      await t.nextly.updateSingle({
        slug: HOMEPAGE,
        data: {
          content: page(heroId, { title: "Old", body: "Kept" }),
          _overwrite: true,
        },
        overrideAccess: true,
      });

      await publishRemoval(t, heroId);

      expect(
        (await retiredRows(t)).map(row => [
          row.componentId,
          row.kind,
          row.exposureId,
        ])
      ).toEqual([[heroId, "property", "title"]]);

      // A page write that carries the blocks value loses the retired one.
      await t.nextly.update({
        collection: NOTES,
        id: noteId,
        data: {
          title: "Edited",
          content: page(heroId, { title: "Old", body: "Kept" }),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(overridesOf((await storedNote(t, noteId)).content)).toEqual({
        body: "Kept",
      });

      // So does a Single's.
      await t.nextly.updateSingle({
        slug: HOMEPAGE,
        data: {
          content: page(heroId, { title: "Old", body: "Kept" }),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const single = (await t.nextly.findSingle({
        slug: HOMEPAGE,
        overrideAccess: true,
      })) as Row;
      expect(overridesOf(single.content)).toEqual({ body: "Kept" });
    });

    it("records an exposure id longer than a short text column holds", async () => {
      const t = await boot();
      const long = `field-${"x".repeat(300)}`;
      const exposing = (ids: string[]) => ({
        ...hero([]),
        exposed: ids.map(id => ({
          id,
          label: "Long",
          nodeId: "h-title",
          propPath: "text",
          type: "text",
        })),
      });
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Long",
          slug: "long",
          content: exposing([long]),
          status: "published",
        },
        overrideAccess: true,
      });
      const id = String(created.item.id);

      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: { content: exposing([]), status: "published", _overwrite: true },
        overrideAccess: true,
      });

      expect((await retiredRows(t)).map(row => row.exposureId)).toEqual([long]);
    });

    it("strips a batch write, whose hooks run inside its transaction", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      const noteId = await note(t, heroId);
      await publishRemoval(t, heroId);

      const batch = (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): BatchEntries;
        }
      ).getEntryService();
      const result = await batch.updateEntries(
        { collectionName: NOTES, overrideAccess: true },
        [
          {
            id: noteId,
            data: {
              content: page(heroId, { title: "Old", body: "Kept" }),
              _overwrite: true,
            },
          },
        ]
      );

      expect(result.successful, JSON.stringify(result)).toBe(1);
      expect(overridesOf((await storedNote(t, noteId)).content)).toEqual({
        body: "Kept",
      });
    });

    it("leaves live values alone when the removal is only saved as a draft", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      const noteId = await note(t, heroId);

      // A status-less edit of a live component is held as its working draft.
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: heroId,
        data: { content: hero(["body"]), _overwrite: true },
        overrideAccess: true,
      });

      expect(await retiredRows(t)).toEqual([]);
      await t.nextly.update({
        collection: NOTES,
        id: noteId,
        data: {
          content: page(heroId, { title: "Old", body: "Kept" }),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(overridesOf((await storedNote(t, noteId)).content)).toEqual({
        title: "Old",
        body: "Kept",
      });
    });

    it("keeps a retired field out of a component restored with it", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      await publishRemoval(t, heroId);

      // What restoring the version before the removal writes.
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: heroId,
        data: {
          content: hero(["title", "body"]),
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });

      const stored = (await t.nextly.findByID({
        collection: COMPONENTS_SLUG,
        id: heroId,
        depth: 0,
        overrideAccess: true,
      })) as Row;
      const content = (
        typeof stored.content === "string"
          ? JSON.parse(stored.content)
          : stored.content
      ) as { exposed: { id: string }[] };
      expect(content.exposed.map(entry => entry.id)).toEqual(["body"]);
    });

    it("publishes a document that still holds a retired value", async () => {
      // Written before the removal and never rewritten since: the cleanup has
      // not reached it, and publishing it must not be refused for that.
      const t = await boot();
      const heroId = await publishedHero(t);
      const created = await t.nextly.create({
        collection: NOTES,
        data: {
          title: "Draft",
          content: page(heroId, { title: "Old", body: "Kept" }),
          status: "draft",
        },
        overrideAccess: true,
      });
      const noteId = String(created.item.id);
      await publishRemoval(t, heroId);

      await t.nextly.update({
        collection: NOTES,
        id: noteId,
        data: { status: "published", _overwrite: true },
        overrideAccess: true,
      });

      const stored = await storedNote(t, noteId);
      expect(stored.status).toBe("published");
      expect(overridesOf(stored.content)).toEqual({
        title: "Old",
        body: "Kept",
      });
    });
  }
);
