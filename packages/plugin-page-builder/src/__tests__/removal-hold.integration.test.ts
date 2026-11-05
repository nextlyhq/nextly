/**
 * A removal held while it is published, against a real database per dialect.
 *
 * What only a database shows: that the hold is read from the bookkeeping
 * table as the system, that a write in the window newly setting a held field
 * is refused on a collection and a Single while one keeping a stored value is
 * not, that a hold that ran out holds nothing, and that publishing the
 * component ends it.
 *
 * @module __tests__/removal-hold.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  COMPONENT_RETIRED_SLUG,
  retiredKey,
} from "../collections/component-retired-exposures";
import { COMPONENTS_SLUG } from "../collections/components";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";
import {
  FIELD_BEING_REMOVED,
  REMOVAL_HOLD,
  REMOVAL_RECOUNT,
} from "../removal-hold";

type Row = Record<string, unknown>;

const NOTES = "notes";
const HOMEPAGE = "homepage";

const heading = (id: string): Row => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

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

function overridesOf(stored: unknown): unknown {
  const document = (
    typeof stored === "string" ? JSON.parse(stored) : stored
  ) as { nodes: { props: { overrides?: unknown } }[] };
  return document.nodes[0]!.props.overrides;
}

/** The error a refused write threw, or `undefined` when it went through. */
async function refusal(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** The issue codes a refusal carries. */
function codesOf(error: unknown): string[] {
  if (!NextlyError.isCode(error, "VALIDATION_ERROR")) return [];
  const issues = (error.publicData as { errors?: { code?: string }[] })?.errors;
  return (issues ?? []).map(issue => String(issue.code));
}

describe.each(getConfiguredTestDialects())(
  "a component's removal held while it is published (%s)",
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

    /** Hold the removal of `title`, as the hold route records it. */
    async function holdTitle(
      t: TestNextly,
      componentId: string,
      until = Date.now() + 60_000,
      confirmed = 1
    ): Promise<void> {
      await t.nextly.create({
        collection: COMPONENT_RETIRED_SLUG,
        data: {
          identity: await retiredKey(componentId, REMOVAL_HOLD, ""),
          componentId,
          kind: REMOVAL_HOLD,
          exposureId: JSON.stringify({
            properties: ["title"],
            slots: [],
            confirmed,
            // A floor, as the dialog says while the usage index is not known
            // whole: the count's completeness then plays no part here.
            confirmedComplete: false,
            until,
            token: "integration",
          }),
        },
        overrideAccess: true,
      });
    }

    async function note(t: TestNextly, overrides: Row, heroId: string) {
      const created = await t.nextly.create({
        collection: NOTES,
        data: { title: "Note", content: page(heroId, overrides) },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function storedNote(t: TestNextly, id: string): Promise<unknown> {
      const row = (await t.nextly.findByID({
        collection: NOTES,
        id,
        depth: 0,
        overrideAccess: true,
      })) as Row;
      return overridesOf(row.content);
    }

    it("refuses a write in the window that newly sets a held field", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      const id = await note(t, { body: "Kept" }, heroId);
      await holdTitle(t, heroId);

      const refused = await refusal(
        t.nextly.update({
          collection: NOTES,
          id,
          data: { content: page(heroId, { title: "New", body: "Kept" }) },
          overrideAccess: true,
        })
      );
      const created = await refusal(
        t.nextly.create({
          collection: NOTES,
          data: { title: "Another", content: page(heroId, { title: "New" }) },
          overrideAccess: true,
        })
      );
      const single = await refusal(
        t.nextly.updateSingle({
          slug: HOMEPAGE,
          data: { content: page(heroId, { title: "New" }) },
          overrideAccess: true,
        })
      );

      expect(codesOf(refused)).toEqual([FIELD_BEING_REMOVED]);
      expect(codesOf(created)).toEqual([FIELD_BEING_REMOVED]);
      expect(codesOf(single)).toEqual([FIELD_BEING_REMOVED]);
      expect(await storedNote(t, id)).toEqual({ body: "Kept" });
    });

    it("lets a document keep a held value it already stores", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      const id = await note(t, { title: "Old", body: "Kept" }, heroId);
      await holdTitle(t, heroId);

      await t.nextly.update({
        collection: NOTES,
        id,
        data: {
          title: "Edited",
          content: page(heroId, { title: "Old", body: "Changed" }),
        },
        overrideAccess: true,
      });

      expect(await storedNote(t, id)).toEqual({
        title: "Old",
        body: "Changed",
      });
    });

    it("holds nothing once the hold has run out", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      const id = await note(t, { body: "Kept" }, heroId);
      await holdTitle(t, heroId, Date.now() - 1);

      await t.nextly.update({
        collection: NOTES,
        id,
        data: { content: page(heroId, { title: "New", body: "Kept" }) },
        overrideAccess: true,
      });

      expect(await storedNote(t, id)).toEqual({ title: "New", body: "Kept" });
    });

    /** The holds the bookkeeping table keeps. */
    async function holdRows(t: TestNextly): Promise<Row[]> {
      const found = await t.nextly.find({
        collection: COMPONENT_RETIRED_SLUG,
        where: { kind: { equals: REMOVAL_HOLD } },
        limit: 10,
        depth: 0,
        overrideAccess: true,
      });
      return found.items as Row[];
    }

    it("ends the hold when the publish drops the held field", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      await note(t, { body: "Kept" }, heroId);
      await holdTitle(t, heroId);

      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: heroId,
        data: { content: hero(["body"]), status: "published" },
        overrideAccess: true,
      });

      expect(await holdRows(t)).toEqual([]);
    });

    it("keeps the hold through a publish that still exposes the held field", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      const id = await note(t, { body: "Kept" }, heroId);
      await holdTitle(t, heroId);

      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: heroId,
        data: { title: "Hero, renamed", status: "published" },
        overrideAccess: true,
      });
      const refused = await refusal(
        t.nextly.update({
          collection: NOTES,
          id,
          data: { content: page(heroId, { title: "New", body: "Kept" }) },
          overrideAccess: true,
        })
      );

      expect(await holdRows(t)).toHaveLength(1);
      expect(codesOf(refused)).toEqual([FIELD_BEING_REMOVED]);
    });

    it("refuses publishing a held removal once more documents place the component", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      await note(t, { body: "Kept" }, heroId);
      // Confirmed at none: the note above is one more than the designer saw.
      await holdTitle(t, heroId, Date.now() + 60_000, 0);

      const refused = await refusal(
        t.nextly.update({
          collection: COMPONENTS_SLUG,
          id: heroId,
          data: { content: hero(["body"]), status: "published" },
          overrideAccess: true,
        })
      );

      expect(codesOf(refused)).toEqual([REMOVAL_RECOUNT]);
      const live = (await t.nextly.findByID({
        collection: COMPONENTS_SLUG,
        id: heroId,
        depth: 0,
        overrideAccess: true,
      })) as Row;
      const content = (
        typeof live.content === "string"
          ? JSON.parse(live.content)
          : live.content
      ) as { exposed: { id: string }[] };
      expect(content.exposed.map(field => field.id)).toEqual(["title", "body"]);
    });
  }
);
