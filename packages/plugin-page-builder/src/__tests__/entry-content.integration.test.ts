/**
 * A template's Entry content block against a real instance: placed and its
 * field chosen through the page actions route, with the refusals an editor
 * save makes, and a template whose chosen field was removed from the
 * collection kept saving with its choice.
 *
 * What only a server shows: the save reads the collection's schema as it
 * stands at the write, so a field removed after the template was saved is
 * judged against the stored template rather than refused, while a field
 * newly chosen that the collection lacks is refused.
 *
 * @module __tests__/entry-content.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { PAGES_SLUG } from "../collections/pages";
import { TEMPLATES_SLUG } from "../collections/templates";
import type { PageActionResult } from "../composition-actions-contract";
import { asOverwrite } from "../document-version";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

import { created, holding, person, post } from "./transfer-harness";

/** Articles hold two blocks fields; notes hold one. */
const ARTICLES = "eci_articles";
const NOTES = "eci_notes";
/** Whose one blocks field accepts a template-kind document. */
const DESIGNS = "eci_designs";

/** Someone who looks after templates and pages, short of nothing. */
const AUTHOR = [
  "read-templates",
  "create-templates",
  "update-templates",
  "publish-templates",
  "read-pages",
  "update-pages",
];

type Node = {
  id: string;
  type: string;
  props: Record<string, unknown>;
};

function documentOf(kind: string, nodes: Node[] = []) {
  return { formatVersion: 1, kind, nodes };
}

function entryContent(id: string, field?: string) {
  return {
    id,
    type: "core/entry-content",
    version: 1,
    props: field === undefined ? {} : { field },
  };
}

/** A collection a template may draw: shown in the admin, with a slug. */
function entryCollection(
  slug: string,
  blocks: readonly string[],
  kinds?: readonly string[]
) {
  return defineCollection({
    slug,
    status: true,
    access: { read: () => true },
    fields: [
      text({ name: "title" }),
      text({ name: "slug", unique: true }),
      ...blocks.map(
        name =>
          ({
            name,
            type: BLOCKS_TYPE,
            ...(kinds === undefined ? {} : { blocks: { kinds } }),
          }) as never
      ),
    ],
  });
}

describe.each(getConfiguredTestDialects())(
  "a template's Entry content (%s)",
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
          entryCollection(ARTICLES, ["body", "sidebar"]),
          entryCollection(NOTES, ["text"]),
          entryCollection(DESIGNS, ["layout"], ["page", "template"]),
        ],
        seedPublic: true,
      });
      // The instance's first user is its super admin, so it is made here
      // and never acts: the author below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    /** The stored document's Entry content blocks, its working draft first. */
    async function storedBlocks(
      t: TestNextly,
      collection: string,
      id: string
    ): Promise<Node[]> {
      const row = (await t.nextly.findByID({
        collection,
        id,
        overrideAccess: true,
        status: "all",
        draft: true,
        depth: 0,
      })) as unknown as { content: { nodes: Node[] } };
      return row.content.nodes.filter(
        node => node.type === "core/entry-content"
      );
    }

    /** One page action, as an API client sends it. */
    async function pageAction(
      cookie: string,
      page: { collection: string; id: string },
      action: unknown,
      dryRun = false
    ) {
      const answer = await post(cookie, ["pages", "actions"], {
        page,
        action,
        ...(dryRun ? { dryRun: true } : {}),
      });
      return {
        status: answer.status,
        result: answer.body.item as PageActionResult | undefined,
        body: answer.body,
      };
    }

    it("places Entry content on a template through the API, naming the collection's one blocks field", async () => {
      const t = await boot();
      const id = await created(t, TEMPLATES_SLUG, {
        title: "Note page",
        collection: NOTES,
        content: documentOf("template"),
      });
      const { cookie } = await holding(t, AUTHOR);
      const page = { collection: TEMPLATES_SLUG, id };

      const placed = await pageAction(cookie, page, {
        kind: "place-entry-content",
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(200);
      // Stored explicit: the collection's one blocks field, chosen for it.
      expect(
        (await storedBlocks(t, TEMPLATES_SLUG, id)).map(node => node.props)
      ).toEqual([{ field: "text" }]);

      // A second one is refused, and nothing more is stored.
      const second = await pageAction(
        cookie,
        page,
        { kind: "place-entry-content", field: "text" },
        true
      );
      expect(second.result?.refusals.join(" ")).toContain(
        "A template holds one Entry content block"
      );
      expect(await storedBlocks(t, TEMPLATES_SLUG, id)).toHaveLength(1);
    });

    it("chooses a field among several, and refuses one the collection lacks, naming it", async () => {
      const t = await boot();
      const id = await created(t, TEMPLATES_SLUG, {
        title: "Article page",
        collection: ARTICLES,
        content: documentOf("template", [entryContent("ec", "body")]),
      });
      const { cookie } = await holding(t, AUTHOR);
      const page = { collection: TEMPLATES_SLUG, id };

      // The control: Sidebar is one of the articles' blocks fields.
      const chosen = await pageAction(cookie, page, {
        kind: "set-entry-content-field",
        nodeId: "ec",
        field: "sidebar",
      });
      expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
      expect((await storedBlocks(t, TEMPLATES_SLUG, id))[0]?.props.field).toBe(
        "sidebar"
      );

      const refused = await pageAction(
        cookie,
        page,
        { kind: "set-entry-content-field", nodeId: "ec", field: "title" },
        true
      );
      const words = refused.result?.refusals.join(" ") ?? "";
      expect(words).toContain('"title"');
      expect(words).toContain("Choose Body or Sidebar.");
      expect((await storedBlocks(t, TEMPLATES_SLUG, id))[0]?.props.field).toBe(
        "sidebar"
      );

      // Several blocks fields and none named: placed naming none, refused
      // until one is chosen.
      const unnamed = await pageAction(
        cookie,
        page,
        { kind: "place-entry-content" },
        true
      );
      expect((unnamed.result?.refusals ?? []).length).toBeGreaterThan(0);
    });

    it("refuses Entry content placed on a page, and in an entry's own blocks field", async () => {
      const t = await boot();
      const { cookie } = await holding(t, AUTHOR);
      const pageId = await created(t, PAGES_SLUG, {
        title: "About",
        slug: "about",
        content: documentOf("page"),
      });
      const onPage = await pageAction(
        cookie,
        { collection: PAGES_SLUG, id: pageId },
        { kind: "place-entry-content", field: "body" },
        true
      );
      expect(onPage.result?.refusals.join(" ")).toContain(
        "belongs in a collection's template"
      );
      expect(await storedBlocks(t, PAGES_SLUG, pageId)).toEqual([]);

      // An entry's own blocks field that accepts a template-kind document
      // still refuses one holding Entry content, which would draw the
      // content that holds it.
      await expect(
        t.nextly.create({
          collection: DESIGNS,
          data: {
            title: "Self",
            slug: "self",
            layout: documentOf("template", [entryContent("ec", "layout")]),
          },
          overrideAccess: true,
        })
      ).rejects.toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "ENTRY_CONTENT_OUTSIDE_TEMPLATES",
              message: expect.stringContaining(
                "not in an entry's blocks field"
              ),
            }),
          ],
        },
      });
      // The control: the same field takes a template-kind document without.
      await expect(
        t.nextly.create({
          collection: DESIGNS,
          data: {
            title: "Plain",
            slug: "plain",
            layout: documentOf("template"),
          },
          overrideAccess: true,
        })
      ).resolves.toBeDefined();
    });

    it("keeps saving a template whose chosen field was removed from the collection, keeping its choice", async () => {
      const t = await boot();
      const id = await created(t, TEMPLATES_SLUG, {
        title: "Article page",
        collection: ARTICLES,
        content: documentOf("template", [entryContent("ec", "sidebar")]),
      });

      // The collection loses Sidebar, as a change to its code removes it at
      // the next sync.
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollection(slug: string): Promise<{ fields?: unknown[] }>;
        updateCollection(
          slug: string,
          data: { fields: unknown[] },
          options: { source: string }
        ): Promise<unknown>;
      };
      const record = await registry.getCollection(ARTICLES);
      await registry.updateCollection(
        ARTICLES,
        {
          fields: (record.fields ?? []).filter(
            field => (field as { name?: unknown }).name !== "sidebar"
          ),
        },
        { source: "code" }
      );

      // An unrelated edit to the template saves, and its choice is kept.
      await t.nextly.update({
        collection: TEMPLATES_SLUG,
        id,
        data: asOverwrite({
          title: "Article page, retitled",
          collection: ARTICLES,
          content: documentOf("template", [entryContent("ec", "sidebar")]),
        }),
        overrideAccess: true,
      });
      expect((await storedBlocks(t, TEMPLATES_SLUG, id))[0]?.props.field).toBe(
        "sidebar"
      );

      // The control: newly choosing a field the collection lacks is refused.
      await expect(
        t.nextly.update({
          collection: TEMPLATES_SLUG,
          id,
          data: asOverwrite({
            collection: ARTICLES,
            content: documentOf("template", [entryContent("ec", "summary")]),
          }),
          overrideAccess: true,
        })
      ).rejects.toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "ENTRY_CONTENT_FIELD_UNKNOWN",
              message: expect.stringContaining('"summary"'),
            }),
          ],
        },
      });
    });
  }
);
