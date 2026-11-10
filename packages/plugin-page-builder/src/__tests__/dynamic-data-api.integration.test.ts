/**
 * Dynamic Data through the API alone, end to end: a collection's template
 * built with the template and page actions, using only ids the composition
 * manifest names, then an entry given its own design, bound and unbound
 * there, and each entry's page rendered as a visitor reads it.
 *
 * What only a server shows: that the actions an API client sends compose a
 * template the site's own content route draws (its entry content, a list of
 * the collection's entries, bindings to the entry and to each list item, and
 * a block shown only when its condition holds); that an unbind on a design
 * keeps the value a visitor sees, read as published; and that a visitor's
 * page never shows a draft entry, a pending draft's values, or a field the
 * public may not read. Beside it, the refusals an editor's save makes, made
 * to an API client in the same words.
 *
 * The page is rendered by the real content route (`createContentPage`, over
 * `pageBuilderContent`), against the real instance, so the address an entry
 * is served at, the design that draws it and the reads it makes are the
 * site's own.
 *
 * @module __tests__/dynamic-data-api.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { BlockNode } from "@nextlyhq/blocks-engine";
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createContentPage } from "@nextlyhq/blocks-react/next";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { Suspense, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { PAGES_SLUG } from "../collections/pages";
import { PATTERNS_SLUG } from "../collections/patterns";
import { TEMPLATES_SLUG } from "../collections/templates";
import type { PageActionResult } from "../composition-actions-contract";
import {
  compositionManifestSchema,
  type CompositionManifest,
} from "../composition-manifest";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";
import type { TemplateActionResult } from "../templates/template-actions-contract";

import {
  call,
  created,
  holding,
  person,
  post,
  unique,
} from "./transfer-harness";

/** The collection the template draws, served at its address in code. */
const STORIES = "dd_stories";
const ADDRESS = "/stories";

/**
 * Looks after templates and own designs, inserts patterns and reads the
 * stories: everything the flow asks, and not the routing permission.
 */
const AUTHOR = [
  "read-templates",
  "create-templates",
  "update-templates",
  "publish-templates",
  "delete-templates",
  "read-patterns",
  `read-${STORIES}`,
];

/** The text of each block the pattern brings, by which the flow finds it. */
const TITLE_TEXT = "Title goes here";
const BANNER_TEXT = "Gold members only";
const NOTE_TEXT = "Note goes here";
const ITEM_TEXT = "Item goes here";

/** What a private field binding draws for visitors instead of the field. */
const NOTE_FALLBACK = "Ask at the desk";

/**
 * Text no visitor's page may ever hold: a draft entry's, a pending draft's of
 * a published one, and a field the public may not read.
 */
const NEVER_SHOWN = [
  "Winter preview",
  "Unannounced winter deal",
  "Unreleased spring title",
  "Unreleased spring blurb",
  "The staff door code",
];

function heading(text: string): BlockNode {
  return {
    id: unique("h"),
    type: "core/heading",
    version: 1,
    props: { text, level: "h2" },
  };
}

function bodyOf(text: string) {
  return { formatVersion: 1, kind: "page", nodes: [heading(text)] };
}

/** Each block a node id names, its slots' blocks included. */
function findIn(
  nodes: readonly BlockNode[],
  match: (node: BlockNode) => boolean
): BlockNode | undefined {
  for (const node of nodes) {
    if (match(node)) return node;
    for (const slot of Object.values(node.slots ?? {})) {
      const inside = findIn(slot, match);
      if (inside !== undefined) return inside;
    }
  }
  return undefined;
}

/** The visitor's HTML of a rendered route element, its async parts awaited. */
async function htmlOf(page: Promise<ReactElement>): Promise<string> {
  // Past the route's Suspense boundary where Cache Components wraps it in one.
  let element = (await page) as ReactElement<{ children: ReactElement }>;
  if (element.type === Suspense) {
    const body = element.props.children;
    const Body = body.type as (props: unknown) => Promise<ReactElement>;
    element = (await Body(body.props)) as typeof element;
  }
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/** What a template action answered, typed. */
const templateOf = (body: Record<string, unknown>) =>
  (body.item as TemplateActionResult).template;

describe.each(getConfiguredTestDialects())(
  "Dynamic Data through the API (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /**
     * An instance with the stories, two published (one with a pending draft)
     * and one only a draft, and a pattern holding the blocks the template is
     * built from.
     */
    async function boot() {
      current = await createTestNextly({
        dialect,
        plugins: [
          pageBuilder({ templates: { addresses: { [STORIES]: ADDRESS } } }),
        ],
        collections: [
          defineCollection({
            slug: STORIES,
            labels: { singular: "Story", plural: "Stories" },
            status: true,
            // Working drafts, so an edit is saved to a draft, as the editor
            // saves it, and a published value can differ from a pending one.
            versions: { drafts: true },
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "slug", unique: true }),
              text({ name: "tier" }),
              text({ name: "blurb" }),
              text({ name: "secret", access: { read: () => false } }),
              { name: "body", type: BLOCKS_TYPE } as never,
              { name: "sidebar", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
        seedPublic: true,
      });
      const t = current;
      // The instance's first user is its super admin, so it is made here and
      // never acts: the author holds only what it is granted.
      await person(t, "owner");
      const story = (data: Record<string, unknown>) =>
        created(t, STORIES, {
          secret: "The staff door code",
          sidebar: bodyOf("Sidebar copy"),
          ...data,
        });
      const spring = await story({
        title: "Spring sale",
        slug: "spring",
        tier: "Gold tier",
        blurb: "Thirty per cent off",
        body: bodyOf("Spring body copy"),
        status: "published",
      });
      const autumn = await story({
        title: "Autumn sale",
        slug: "autumn",
        tier: "Standard tier",
        blurb: "Half price coats",
        body: bodyOf("Autumn body copy"),
        status: "published",
      });
      const winter = await story({
        title: "Winter preview",
        slug: "winter",
        tier: "Gold tier",
        blurb: "Unannounced winter deal",
        body: bodyOf("Winter body copy"),
        status: "draft",
      });
      // A draft of the spring story changes it; visitors still see the live one.
      await t.nextly.update({
        collection: STORIES,
        id: spring,
        data: {
          title: "Unreleased spring title",
          blurb: "Unreleased spring blurb",
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await created(t, PATTERNS_SLUG, {
        title: "Story section",
        slug: unique("story-section"),
        granularity: "section",
        status: "published",
        content: {
          formatVersion: 1,
          kind: "pattern",
          nodes: [
            heading(TITLE_TEXT),
            heading(BANNER_TEXT),
            heading(NOTE_TEXT),
            {
              id: unique("list"),
              type: "core/collection-loop",
              version: 1,
              props: { collection: STORIES, limit: 3 },
              slots: { children: [heading(ITEM_TEXT)] },
            },
          ],
        },
      });
      const author = await holding(t, AUTHOR);
      return { t, cookie: author.cookie, spring, autumn, winter };
    }

    async function manifestOf(cookie: string): Promise<CompositionManifest> {
      const read = await call("GET", cookie, ["manifest"]);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      return compositionManifestSchema.parse(read.body);
    }

    const templateAction = (cookie: string, action: unknown, dryRun = false) =>
      post(cookie, ["templates", "actions"], {
        action,
        ...(dryRun ? { dryRun: true } : {}),
      });

    /** One page action on a template, as an API client sends it. */
    const pageAction = (
      cookie: string,
      at: { collection: string; id: string },
      action: Record<string, unknown>,
      dryRun = false
    ) =>
      post(cookie, ["pages", "actions"], {
        page: at,
        action,
        ...(dryRun ? { dryRun: true } : {}),
      });

    /** A page action that must be accepted, answering what it did. */
    async function applied(
      cookie: string,
      at: { collection: string; id: string },
      action: Record<string, unknown>
    ): Promise<PageActionResult> {
      const answer = await pageAction(cookie, at, action);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return answer.body.item as PageActionResult;
    }

    /** A template's design as its working draft stores it. */
    async function design(t: TestNextly, id: string): Promise<BlockNode[]> {
      const row = (await t.nextly.findByID({
        collection: TEMPLATES_SLUG,
        id,
        overrideAccess: true,
        status: "all",
        draft: true,
        depth: 0,
      })) as unknown as { content: { nodes: BlockNode[] } };
      return row.content.nodes;
    }

    /** A story's page, rendered by the site's content route as a visitor. */
    function visitorPage(t: TestNextly, slug: string): Promise<string> {
      const route = createContentPage({
        ...pageBuilderContent({ nextly: t.nextly as never }),
        pages: {
          collections: [PAGES_SLUG],
          field: "content",
          nextly: t.nextly as never,
          blocks: createBlockResolver(coreBlocks),
        },
      });
      return htmlOf(
        route.ContentPage({
          params: { slug: [...ADDRESS.split("/").filter(Boolean), slug] },
        })
      );
    }

    /**
     * Build the stories' template with the actions alone, from ids the
     * manifest names: entry content, the pattern's blocks, the list's query,
     * a binding to the entry, one to each list item and one to a field the
     * public may not read, the banner's condition, then publish it.
     */
    /**
     * The templates collection the manifest names. This server always names
     * it; the key is optional only for manifests from servers that predate it.
     */
    function templatesCollectionOf(manifest: {
      collections: { templates?: string };
    }): string {
      const slug = manifest.collections.templates;
      if (slug === undefined) {
        throw new Error("the manifest named no templates collection");
      }
      return slug;
    }

    async function buildTemplate(t: TestNextly, cookie: string) {
      const manifest = await manifestOf(cookie);
      // Under the name the host gave it: here the plugin's own.
      expect(manifest.collections.templates).toBe(TEMPLATES_SLUG);
      const pattern = manifest.patterns.items.find(
        item => item.title === "Story section"
      );
      if (pattern === undefined) {
        throw new Error("the manifest did not list the pattern");
      }

      const made = await templateAction(cookie, {
        kind: "create-template",
        collection: STORIES,
      });
      expect(made.status, JSON.stringify(made.body)).toBe(200);
      const template = templateOf(made.body)?.id ?? "";
      expect(templateOf(made.body)).toMatchObject({
        collection: STORIES,
        status: "draft",
      });
      const at = { collection: templatesCollectionOf(manifest), id: template };

      // Entry content, placed drawing one field and moved to the other.
      const placed = await applied(cookie, at, {
        kind: "place-entry-content",
        field: "sidebar",
      });
      const entryContent = placed.insertedId ?? "";
      expect(entryContent).not.toBe("");
      await applied(cookie, at, {
        kind: "set-entry-content-field",
        nodeId: entryContent,
        field: "body",
      });

      const inserted = await applied(cookie, at, {
        kind: "insert-pattern",
        patternId: pattern.id,
      });
      const nodes = inserted.document?.nodes ?? [];
      const byText = (text: string) =>
        findIn(nodes, node => node.props.text === text)?.id ?? "";
      const ids = {
        entryContent,
        title: byText(TITLE_TEXT),
        banner: byText(BANNER_TEXT),
        note: byText(NOTE_TEXT),
        list:
          findIn(nodes, node => node.type === "core/collection-loop")?.id ?? "",
        item: byText(ITEM_TEXT),
      };
      for (const [name, id] of Object.entries(ids)) {
        expect(id, `${name} was not inserted`).not.toBe("");
      }

      await applied(cookie, at, {
        kind: "set-list-query",
        listId: ids.list,
        query: { collection: STORIES, sort: "title", limit: 10 },
      });
      await applied(cookie, at, {
        kind: "bind-prop",
        nodeId: ids.title,
        prop: "text",
        binding: { $bind: "title" },
      });
      await applied(cookie, at, {
        kind: "bind-prop",
        nodeId: ids.item,
        prop: "text",
        binding: { $bind: "blurb", source: "item" },
      });
      // A field the public may not read binds, as an editor's save allows:
      // visitors are drawn the fallback.
      await applied(cookie, at, {
        kind: "bind-prop",
        nodeId: ids.note,
        prop: "text",
        binding: { $bind: "secret", fallback: NOTE_FALLBACK },
      });
      await applied(cookie, at, {
        kind: "set-conditions",
        nodeId: ids.banner,
        conditions: [[{ field: "tier", op: "equals", value: "Gold tier" }]],
      });

      const stored = await design(t, template);
      expect(
        findIn(stored, node => node.id === ids.entryContent)?.props
      ).toEqual({ field: "body" });
      expect(findIn(stored, node => node.id === ids.list)?.props).toEqual({
        collection: STORIES,
        sort: "title",
        limit: 10,
      });
      expect(findIn(stored, node => node.id === ids.item)?.bindings).toEqual({
        text: { $bind: "blurb", source: "item" },
      });
      // Stored as a binding with its fallback, not as the fallback's text:
      // a visitor drawn "Ask at the desk" proves nothing on its own, since a
      // prop written as that literal would draw the same words.
      expect(findIn(stored, node => node.id === ids.note)?.bindings).toEqual({
        text: { $bind: "secret", fallback: NOTE_FALLBACK },
      });
      expect(
        findIn(stored, node => node.id === ids.banner)?.visibility
      ).toEqual({
        conditions: [[{ field: "tier", op: "equals", value: "Gold tier" }]],
      });

      const published = await templateAction(cookie, {
        kind: "publish-template",
        id: template,
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(templateOf(published.body)?.status).toBe("published");
      return { manifest, template, at, ids };
    }

    // Long by design: one author's whole path through the API, against a
    // real instance, then the pages a visitor is served.
    it("builds a template from the manifest's ids alone, and a visitor's page draws it", async () => {
      const { t, cookie } = await boot();
      await buildTemplate(t, cookie);

      const autumn = await visitorPage(t, "autumn");
      // The entry's own title, its body drawn by Entry content, and each
      // published story's blurb in the list.
      expect(autumn).toContain("Autumn sale");
      expect(autumn).toContain("Autumn body copy");
      expect(autumn).not.toContain("Sidebar copy");
      expect(autumn).toContain("Thirty per cent off");
      expect(autumn).toContain("Half price coats");
      // The private field's fallback, never its value.
      expect(autumn).toContain(NOTE_FALLBACK);
      // The banner's condition does not hold for a standard story.
      expect(autumn).not.toContain(BANNER_TEXT);

      const spring = await visitorPage(t, "spring");
      expect(spring).toContain("Spring sale");
      expect(spring).toContain("Spring body copy");
      // The control for the condition: it holds for a gold story.
      expect(spring).toContain(BANNER_TEXT);

      for (const page of [autumn, spring]) {
        for (const hidden of NEVER_SHOWN) expect(page).not.toContain(hidden);
      }
    }, 60_000);

    it("gives one entry its own design, keeps what a visitor sees on unbinding there, and removes it", async () => {
      const { t, cookie, spring, autumn } = await boot();
      const { manifest, ids } = await buildTemplate(t, cookie);

      const given = await templateAction(cookie, {
        kind: "give-entry-design",
        collection: STORIES,
        entry: spring,
        title: "Spring sale design",
      });
      expect(given.status, JSON.stringify(given.body)).toBe(200);
      expect(templateOf(given.body)).toMatchObject({
        collection: STORIES,
        entry: spring,
        status: "draft",
      });
      const own = {
        collection: templatesCollectionOf(manifest),
        id: templateOf(given.body)?.id ?? "",
      };

      // A binding of the own design's own: the banner shows the tier.
      await applied(cookie, own, {
        kind: "bind-prop",
        nodeId: ids.banner,
        prop: "text",
        binding: { $bind: "tier" },
      });

      // "visitor", the keep an unbind takes by default, cannot say whose
      // value a design shows: it is refused, naming the entry to name.
      const visitor = await pageAction(cookie, own, {
        kind: "unbind-prop",
        nodeId: ids.banner,
        prop: "text",
        keep: "visitor",
      });
      expect(visitor.status).toBe(422);
      expect(JSON.stringify(visitor.body)).toContain("name the entry");

      // The entry named: its PUBLISHED title is kept, not its pending draft's.
      const entry = await applied(cookie, own, {
        kind: "unbind-prop",
        nodeId: ids.title,
        prop: "text",
        keep: { entry: spring },
      });
      expect(entry.unbound).toMatchObject({ value: "Spring sale" });

      // An item named: the autumn story's blurb is kept for every item.
      const item = await applied(cookie, own, {
        kind: "unbind-prop",
        nodeId: ids.item,
        prop: "text",
        keep: { item: autumn },
      });
      expect(item.unbound).toMatchObject({ value: "Half price coats" });

      const stored = await design(t, own.id);
      for (const [nodeId, kept] of [
        [ids.title, "Spring sale"],
        [ids.item, "Half price coats"],
      ] as const) {
        const node = findIn(stored, found => found.id === nodeId);
        expect(node?.props.text).toBe(kept);
        expect(node?.bindings?.text).toBeUndefined();
      }
      expect(findIn(stored, node => node.id === ids.banner)?.bindings).toEqual({
        text: { $bind: "tier" },
      });

      // A draft own design is never drawn: the template still is.
      const whileDraft = await visitorPage(t, "spring");
      expect(whileDraft).toContain(BANNER_TEXT);
      expect(whileDraft).not.toContain("Gold tier");

      const published = await templateAction(cookie, {
        kind: "publish-template",
        id: own.id,
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);

      const ownPage = await visitorPage(t, "spring");
      expect(ownPage).toContain("Spring sale");
      // The banner's own binding drawn, its condition holding.
      expect(ownPage).toContain("Gold tier");
      // The kept item value in place of each item's own.
      expect(ownPage).toContain("Half price coats");
      expect(ownPage).not.toContain("Thirty per cent off");
      expect(ownPage).toContain("Spring body copy");
      expect(ownPage).toContain(NOTE_FALLBACK);

      // Its neighbour is still drawn with the template.
      const autumnPage = await visitorPage(t, "autumn");
      expect(autumnPage).toContain("Autumn sale");
      expect(autumnPage).toContain("Thirty per cent off");
      expect(autumnPage).not.toContain("Gold tier");

      const removed = await templateAction(cookie, {
        kind: "remove-entry-design",
        collection: STORIES,
        entry: spring,
      });
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      const again = await visitorPage(t, "spring");
      // Drawn with the template again: its literal banner and bound list.
      expect(again).toContain(BANNER_TEXT);
      expect(again).not.toContain("Gold tier");
      expect(again).toContain("Thirty per cent off");

      for (const page of [ownPage, autumnPage, again]) {
        for (const hidden of NEVER_SHOWN) expect(page).not.toContain(hidden);
      }
    }, 60_000);

    it("refuses what an editor's save refuses, in the same words", async () => {
      const { t, cookie } = await boot();
      const { manifest, template, at, ids } = await buildTemplate(t, cookie);
      const before = JSON.stringify(await design(t, template));

      // A field the stories lack: the dry run names it, the apply is refused.
      const missing = {
        kind: "bind-prop",
        nodeId: ids.title,
        prop: "text",
        binding: { $bind: "headline" },
      };
      const dry = await pageAction(cookie, at, missing, true);
      expect(dry.status).toBe(200);
      expect((dry.body.item as PageActionResult).refusals.join("\n")).toContain(
        "headline"
      );
      expect((await pageAction(cookie, at, missing)).status).toBe(422);

      // A condition on a field the public may not read would reveal it.
      const secret = await pageAction(cookie, at, {
        kind: "set-conditions",
        nodeId: ids.banner,
        conditions: [[{ field: "secret", op: "exists" }]],
      });
      expect(secret.status).toBe(422);
      expect(JSON.stringify(secret.body)).toContain("visitors can't see");

      // A template's entries each show their own value, and a list's items
      // theirs: unbinding without naming whose is refused.
      const noEntry = await pageAction(cookie, at, {
        kind: "unbind-prop",
        nodeId: ids.title,
        prop: "text",
      });
      expect(noEntry.status).toBe(422);
      expect(JSON.stringify(noEntry.body)).toContain("name the entry");
      const noItem = await pageAction(cookie, at, {
        kind: "unbind-prop",
        nodeId: ids.item,
        prop: "text",
      });
      expect(noItem.status).toBe(422);
      expect(JSON.stringify(noItem.body)).toContain("name the item");

      // A collection has one template, and the refusal names it.
      const second = await templateAction(cookie, {
        kind: "create-template",
        collection: STORIES,
      });
      expect(second.status).toBe(409);
      expect(JSON.stringify(second.body)).toContain(template);

      // Where a collection's entries are served needs its own permission,
      // asked before anything else.
      const address = await templateAction(cookie, {
        kind: "set-template-address",
        id: template,
        address: "/tales",
      });
      expect(address.status).toBe(403);

      // Nothing refused was written.
      expect(JSON.stringify(await design(t, template))).toBe(before);
      const templates = await t.nextly.find({
        collection: templatesCollectionOf(manifest),
        overrideAccess: true,
        status: "all",
        limit: 10,
      });
      expect(templates.items).toHaveLength(1);
      expect(
        (templates.items[0] as Record<string, unknown> | undefined)?.address ??
          null
      ).toBeNull();
    }, 60_000);
  }
);
