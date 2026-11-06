/**
 * The composition actions an API client makes, against a real instance,
 * through Nextly's own request handler with a session or an API key.
 *
 * What only a server shows: that each action's dry run writes nothing and
 * answers what the site's own write would say, refusals included; that an
 * apply writes what the dry run showed; that a stale fingerprint is refused;
 * and that each answer says who made the change, person or API key, and the
 * site records a person's change on the page's events.
 *
 * @module __tests__/composition-actions-api.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  COMPONENT_INSTANCE_TYPE,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { definePlugin, getCachedNextly } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import {
  definitionActionPath,
  type DefinitionActionRequest,
  type DefinitionActionResult,
  type PageActionRequest,
  type PageActionResult,
} from "../composition-actions-contract";
import {
  asOverwrite,
  documentVersionOf,
  withVersionFrom,
} from "../document-version";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";
import type { SavePatternDryRunResponse } from "../library-contract";
import { MANAGE_SITE_PERMISSION } from "../site-settings";

import { created, holding, person, post, unique } from "./transfer-harness";

/** An author who may edit pages and components, and read what they place. */
const AUTHOR = [
  "read-pages",
  "update-pages",
  "read-patterns",
  "create-patterns",
  "publish-patterns",
  "read-components",
  "update-components",
  "publish-components",
  "read-layouts",
];

function heading(id: string, text: string): BlockNode {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

/** The title marker of a page whose saves a hook rewrites. */
const STAMP_MARK = "stamped";
/** How many saves the hook below has rewritten, so no two read alike. */
let stamps = 0;

/**
 * A plugin whose only act is to rewrite the first block's text on every save
 * of a page whose title carries the marker, as a host's normalising hook
 * might: what is stored is not what was sent.
 */
const stampingPages = definePlugin({
  name: "@t/stamping-pages",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.hooks.on("beforeUpdate", "pages", hook => {
      const { data, originalData } = hook as {
        data?: Record<string, unknown>;
        originalData?: { title?: unknown };
      };
      const content = data?.content as { nodes?: BlockNode[] } | undefined;
      if (!String(originalData?.title ?? "").includes(STAMP_MARK)) return data;
      if (content?.nodes === undefined) return data;
      const [first, ...rest] = content.nodes;
      if (first === undefined) return data;
      return {
        ...data,
        content: {
          ...content,
          nodes: [
            {
              ...first,
              props: {
                ...first.props,
                text: `Stamped ${String((stamps += 1))}`,
              },
            },
            ...rest,
          ],
        },
      };
    });
  },
});

describe.each(getConfiguredTestDialects())(
  "composition actions through the API (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(
      options: { hostComponents?: boolean } = {}
    ): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [
          options.hostComponents === true
            ? pageBuilder({
                componentReadiness: {
                  collection: "site_components",
                  field: "blocks",
                },
              })
            : pageBuilder(),
          stampingPages,
        ],
        collections: [
          // A host collection with a lifecycle but no working drafts: a save
          // that names no status lands on the live entry.
          // Where a host keeps its components, named by `componentReadiness`.
          defineCollection({
            slug: "site_components",
            fields: [
              text({ name: "title" }),
              {
                name: "blocks",
                type: BLOCKS_TYPE,
                blocks: { kinds: ["component"] },
              } as never,
            ],
          }),
          defineCollection({
            slug: "articles",
            status: true,
            fields: [
              text({ name: "title" }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
        seedPublic: true,
      });
      // The instance's first user is its super admin, so it is made here and
      // never acts: every author below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    /** A page, a published pattern, and a published card with one field and one variant. */
    async function site(t: TestNextly) {
      const page = await created(t, "pages", {
        title: "Home",
        slug: unique("home"),
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("lead", "Lead")],
        },
      });
      const pattern = await created(t, PATTERNS_SLUG, {
        title: "Hero",
        slug: unique("hero"),
        granularity: "section",
        status: "published",
        content: {
          formatVersion: 1,
          kind: "pattern",
          nodes: [heading("h", "From the pattern")],
        },
      });
      const card = await created(t, COMPONENTS_SLUG, {
        title: "Card",
        slug: unique("card"),
        status: "published",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading("t", "Card title")],
          exposed: [
            {
              id: "title",
              label: "Title",
              nodeId: "t",
              propPath: "text",
              type: "text",
            },
          ],
          variants: {
            "v-dark": { label: "Dark", overrides: { title: "Dark title" } },
          },
        },
      });
      return { page, pattern, card };
    }

    async function stored(t: TestNextly, collection: string, id: string) {
      return (await t.nextly.findByID({
        collection,
        id,
        overrideAccess: true,
        status: "all",
        draft: true,
        depth: 0,
      })) as unknown as Record<string, unknown>;
    }

    async function nodes(t: TestNextly, page: string): Promise<BlockNode[]> {
      return (
        (await stored(t, "pages", page)).content as { nodes: BlockNode[] }
      ).nodes;
    }

    const act = (as: string | { bearer: string }, body: unknown) =>
      post(as, ["pages", "actions"], body);

    it("inserts a pattern: the dry run writes nothing, the apply copies its blocks", async () => {
      const t = await boot();
      const { page, pattern } = await site(t);
      const { cookie } = await holding(t, AUTHOR);
      const request: PageActionRequest = {
        page: { collection: "pages", id: page },
        action: { kind: "insert-pattern", patternId: pattern },
      };

      const dry = await act(cookie, { ...request, dryRun: true });

      expect(dry.status).toBe(200);
      const preview = dry.body.item as PageActionResult;
      expect(preview.refusals).toEqual([]);
      expect(preview.document?.nodes.map(node => node.props.text)).toEqual([
        "Lead",
        "From the pattern",
      ]);
      expect((await nodes(t, page)).map(node => node.id)).toEqual(["lead"]);

      const applied = await act(cookie, {
        ...request,
        expect: preview.fingerprint,
      });

      expect(applied.status).toBe(200);
      const after = await nodes(t, page);
      expect(after.map(node => node.props.text)).toEqual([
        "Lead",
        "From the pattern",
      ]);
      expect(after[1]?.origin).toMatchObject({ from: "pattern", id: pattern });
    });

    it("places a component with a variant and values, then changes and resets them", async () => {
      const t = await boot();
      const { page, card } = await site(t);
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: "pages", id: page };

      const placed = await act(cookie, {
        page: at,
        action: {
          kind: "place-component",
          componentId: card,
          variant: "v-dark",
          values: { title: "Mine" },
        },
      });
      expect(placed.status).toBe(200);
      const instanceId =
        (placed.body.item as PageActionResult).insertedId ?? "";
      expect((await nodes(t, page))[1]).toMatchObject({
        id: instanceId,
        type: COMPONENT_INSTANCE_TYPE,
        props: {
          componentId: card,
          variant: "v-dark",
          overrides: { title: "Mine" },
        },
      });

      const reset = await act(cookie, {
        page: at,
        action: { kind: "set-placement-values", instanceId, reset: ["title"] },
      });
      expect(reset.status).toBe(200);
      const defaults = await act(cookie, {
        page: at,
        action: { kind: "choose-variant", instanceId, variant: null },
      });
      expect(defaults.status).toBe(200);
      expect((await nodes(t, page))[1]?.props).toEqual({ componentId: card });
    });

    it("answers in the dry run what the write would refuse, and refuses the apply", async () => {
      const t = await boot();
      const { page, card } = await site(t);
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: "pages", id: page };
      const placed = await act(cookie, {
        page: at,
        action: { kind: "place-component", componentId: card },
      });
      const instanceId =
        (placed.body.item as PageActionResult).insertedId ?? "";
      const before = await nodes(t, page);

      for (const action of [
        { kind: "set-placement-values", instanceId, values: { title: 42 } },
        { kind: "choose-variant", instanceId, variant: "v-missing" },
      ]) {
        const dry = await act(cookie, { page: at, action, dryRun: true });
        expect(dry.status).toBe(200);
        expect((dry.body.item as PageActionResult).refusals).not.toEqual([]);

        const applied = await act(cookie, { page: at, action });
        expect(applied.status).toBe(422);
      }
      expect(await nodes(t, page)).toEqual(before);
    });

    it("refuses an apply planned against a page that has changed since", async () => {
      const t = await boot();
      const { page, pattern } = await site(t);
      const { cookie } = await holding(t, AUTHOR);
      const request: PageActionRequest = {
        page: { collection: "pages", id: page },
        action: { kind: "insert-pattern", patternId: pattern },
      };
      const dry = await act(cookie, { ...request, dryRun: true });
      const fingerprint = (dry.body.item as PageActionResult).fingerprint;

      // Someone else edits the page after the preview, from their own read.
      await t.nextly.update({
        collection: "pages",
        id: page,
        data: withVersionFrom(
          {
            content: {
              formatVersion: 1,
              kind: "page",
              nodes: [heading("lead", "Edited")],
            },
          },
          documentVersionOf(await stored(t, "pages", page))
        ),
        overrideAccess: true,
      });
      const applied = await act(cookie, { ...request, expect: fingerprint });

      expect(applied.status).toBe(409);
      expect((await nodes(t, page)).map(node => node.props.text)).toEqual([
        "Edited",
      ]);
    });

    it("refuses an apply when the page is saved between its read and its write", async () => {
      const t = await boot();
      const { page, pattern } = await site(t);
      const { cookie } = await holding(t, AUTHOR);
      // Someone else's save lands just after the action reads the page, so
      // it plans from the older page.
      const direct = await getCachedNextly();
      const read = direct.findByID.bind(direct);
      let saved = false;
      const spy = vi
        .spyOn(direct, "findByID")
        .mockImplementation(async (args: Parameters<typeof read>[0]) => {
          const row = await read(args);
          if (args.collection === "pages" && !saved) {
            saved = true;
            // From the version the action's read gave, so this save is
            // accepted and the action's write, carrying that same version,
            // is the one that arrives too late.
            await t.nextly.update({
              collection: "pages",
              id: page,
              data: withVersionFrom(
                {
                  content: {
                    formatVersion: 1,
                    kind: "page",
                    nodes: [heading("lead", "Saved meanwhile")],
                  },
                },
                documentVersionOf(row)
              ),
              overrideAccess: true,
            });
          }
          return row;
        });
      try {
        const applied = await act(cookie, {
          page: { collection: "pages", id: page },
          action: { kind: "insert-pattern", patternId: pattern },
        });
        expect(applied.status).toBe(409);
      } finally {
        spy.mockRestore();
      }
      expect((await nodes(t, page)).map(node => node.props.text)).toEqual([
        "Saved meanwhile",
      ]);
    });

    it("answers the page as the save stores it, after the site's hooks", async () => {
      const t = await boot();
      const { pattern } = await site(t);
      const page = await created(t, "pages", {
        title: `Home ${STAMP_MARK}`,
        slug: unique("stamped"),
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("lead", "Lead")],
        },
      });
      const { cookie } = await holding(t, AUTHOR);

      const dry = await act(cookie, {
        page: { collection: "pages", id: page },
        action: { kind: "insert-pattern", patternId: pattern },
        dryRun: true,
      });

      const previewed = (dry.body.item as PageActionResult).document?.nodes;
      expect(previewed?.[0]?.props.text).toMatch(/^Stamped \d+$/);
      expect(previewed?.[1]?.props.text).toBe("From the pattern");

      // The apply answers what it committed, which the hook stamped anew.
      const applied = await act(cookie, {
        page: { collection: "pages", id: page },
        action: { kind: "insert-pattern", patternId: pattern },
      });
      const answered = (applied.body.item as PageActionResult).document?.nodes;
      const kept = await nodes(t, page);
      expect(answered?.[0]?.props.text).toBe(kept[0]?.props.text);
      expect(answered?.[0]?.props.text).not.toBe(previewed?.[0]?.props.text);
    });

    it("refuses a field that holds no blocks, rather than failing", async () => {
      const t = await boot();
      const { page, pattern } = await site(t);
      const { cookie } = await holding(t, AUTHOR);

      const answer = await act(cookie, {
        page: { collection: "pages", id: page, field: "title" },
        action: { kind: "insert-pattern", patternId: pattern },
      });

      expect(answer.status).toBe(422);
    });

    it("asks for the publish right where a save lands on the live entry", async () => {
      const t = await boot();
      const { pattern } = await site(t);
      const article = await created(t, "articles", {
        title: "News",
        status: "published",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("lead", "Lead")],
        },
      });
      const reads = ["read-patterns", "read-articles", "update-articles"];
      const editor = await holding(t, reads);
      const publisher = await holding(t, [...reads, "publish-articles"]);
      const request: PageActionRequest = {
        page: { collection: "articles", id: article },
        action: { kind: "insert-pattern", patternId: pattern },
      };

      expect((await act(editor.cookie, request)).status).toBe(403);
      expect((await act(publisher.cookie, request)).status).toBe(200);
    });

    it("turns the Layout back on when one is chosen without the switch", async () => {
      const t = await boot();
      const { page } = await site(t);
      // A fixture: the switch set whatever the page holds.
      await t.nextly.update({
        collection: "pages",
        id: page,
        data: asOverwrite({ noHeaderFooter: true }),
        overrideAccess: true,
      });
      const { cookie } = await holding(t, AUTHOR);

      await act(cookie, {
        page: { collection: "pages", id: page },
        action: { kind: "set-layout", layout: null },
      });

      expect((await stored(t, "pages", page)).noHeaderFooter).toBe(false);
    });

    it("chooses a page's Layout, and the site default again", async () => {
      const t = await boot();
      const { page, card } = await site(t);
      const layout = await created(t, LAYOUTS_SLUG, {
        title: "Landing",
        slug: unique("landing"),
        status: "published",
        areas: [{ area: "header", component: card }],
      });
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: "pages", id: page };

      const dry = await act(cookie, {
        page: at,
        action: { kind: "set-layout", layout },
        dryRun: true,
      });
      expect((dry.body.item as PageActionResult).layout).toEqual({
        layout,
        noHeaderFooter: false,
      });
      expect((await stored(t, "pages", page)).layout ?? null).toBeNull();

      await act(cookie, { page: at, action: { kind: "set-layout", layout } });
      expect(String((await stored(t, "pages", page)).layout)).toBe(layout);

      await act(cookie, {
        page: at,
        action: { kind: "set-layout", layout: null },
      });
      expect((await stored(t, "pages", page)).layout ?? null).toBeNull();
    });

    it("says who made the change, a person or an API key, and records the person's", async () => {
      const t = await boot();
      const { page, pattern } = await site(t);
      const author = await holding(t, AUTHOR);
      const request: PageActionRequest = {
        page: { collection: "pages", id: page },
        action: { kind: "insert-pattern", patternId: pattern },
      };
      const events = async () =>
        (
          await t.nextly.contentEvents.list({
            subject: { kind: "collection", slug: "pages", id: page },
          })
        ).items;

      const bySession = await act(author.cookie, request);
      expect((bySession.body.item as PageActionResult).by).toEqual({
        kind: "user",
        userId: author.id,
      });
      expect((await events())[0]).toMatchObject({
        actorKind: "person",
        actorId: author.id,
      });

      const made = await t.nextly.apiKeys.create({
        userId: author.id,
        name: "agent",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      const byKey = await act({ bearer: made.key }, request);
      expect(byKey.status).toBe(200);
      expect((byKey.body.item as PageActionResult).by).toEqual({
        kind: "api-key",
        userId: author.id,
        apiKeyId: made.doc.id,
      });
    });

    it("says who chose the default Layout and who asked to remove one, a key included", async () => {
      const t = await boot();
      const { card } = await site(t);
      const layout = await created(t, LAYOUTS_SLUG, {
        title: "Landing",
        slug: unique("landing"),
        status: "published",
        areas: [{ area: "header", component: card }],
      });
      const admin = await holding(t, [
        "read-layouts",
        "update-layouts",
        "publish-layouts",
        MANAGE_SITE_PERMISSION,
      ]);
      const made = await t.nextly.apiKeys.create({
        userId: admin.id,
        name: "agent",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      const asKey = {
        kind: "api-key",
        userId: admin.id,
        apiKeyId: made.doc.id,
      };

      const bySession = await post(
        admin.cookie,
        ["layouts", layout, "make-default"],
        {
          dryRun: true,
        }
      );
      expect(bySession.body.item).toMatchObject({
        dryRun: true,
        by: { kind: "user", userId: admin.id },
      });
      const byKey = await post(
        { bearer: made.key },
        ["layouts", layout, "make-default"],
        {
          dryRun: true,
        }
      );
      expect(byKey.body.item).toMatchObject({ dryRun: true, by: asKey });
      const removal = await post(
        { bearer: made.key },
        ["layouts", layout, "remove"],
        {
          action: "unpublish",
          dryRun: true,
        }
      );
      expect(removal.status).toBe(200);
      expect(removal.body.item).toMatchObject({ dryRun: true, by: asKey });
    });

    describe("a component's definition", () => {
      const edit = (cookie: string, card: string, body: unknown) =>
        post(cookie, definitionActionPath(card).slice(1).split("/"), body);

      it("exposes a field and defines a variant, a dry run writing nothing", async () => {
        const t = await boot();
        const { card } = await site(t);
        const { cookie } = await holding(t, AUTHOR);
        const definition = async () =>
          (await stored(t, COMPONENTS_SLUG, card)).content as {
            exposed: { id: string; label: string }[];
            variants: Record<
              string,
              { label: string; overrides: Record<string, unknown> }
            >;
          };

        const dry = await edit(cookie, card, {
          action: {
            kind: "expose",
            label: "Level",
            nodeId: "t",
            propPath: "level",
          },
          dryRun: true,
        });
        expect(dry.status).toBe(200);
        const preview = dry.body.item as DefinitionActionResult;
        expect(preview.refusals).toEqual([]);
        expect(preview.definition.exposed?.map(field => field.label)).toEqual([
          "Title",
          "Level",
        ]);
        expect((await definition()).exposed.map(field => field.label)).toEqual([
          "Title",
        ]);

        const exposed = await edit(cookie, card, {
          action: {
            kind: "expose",
            label: "Level",
            nodeId: "t",
            propPath: "level",
          },
          expect: preview.fingerprint,
        });
        expect(exposed.status).toBe(200);
        const added = await edit(cookie, card, {
          action: { kind: "add-variant", label: "Light" },
        });
        const variantId = (added.body.item as DefinitionActionResult).targetId;
        await edit(cookie, card, {
          action: {
            kind: "set-variant-value",
            variantId,
            exposureId: "title",
            value: "Light title",
          },
        });

        const after = await definition();
        expect(after.exposed.map(field => field.label)).toEqual([
          "Title",
          "Level",
        ]);
        expect(after.variants[variantId]).toEqual({
          label: "Light",
          overrides: { title: "Light title" },
        });
        // The existing variant keeps its stable id.
        expect(Object.keys(after.variants).sort()).toEqual(
          ["v-dark", variantId].sort()
        );
      });

      it("refuses what the view refuses, naming why, and writes nothing", async () => {
        const t = await boot();
        const { card } = await site(t);
        const { cookie } = await holding(t, AUTHOR);
        const before = await stored(t, COMPONENTS_SLUG, card);

        const taken = await edit(cookie, card, {
          action: { kind: "add-variant", label: " dark " },
        });
        expect(taken.status).toBe(422);
        expect(JSON.stringify(taken.body)).toContain("label-taken");

        const badValue = await edit(cookie, card, {
          action: {
            kind: "set-variant-value",
            variantId: "v-dark",
            exposureId: "title",
            value: 7,
          },
        });
        expect(badValue.status).toBe(422);
        expect(await stored(t, COMPONENTS_SLUG, card)).toEqual(before);
      });

      it("edits a component kept in the host's own collection", async () => {
        const t = await boot({ hostComponents: true });
        const card = await created(t, "site_components", {
          title: "Card",
          blocks: {
            formatVersion: 1,
            kind: "component",
            nodes: [heading("t", "Card title")],
            exposed: [
              {
                id: "title",
                label: "Title",
                nodeId: "t",
                propPath: "text",
                type: "text",
              },
            ],
          },
        });
        const { cookie } = await holding(t, [
          "read-site_components",
          "update-site_components",
        ]);

        const added = await edit(cookie, card, {
          action: { kind: "add-variant", label: "Dark" },
        });

        expect(added.status).toBe(200);
        const variantId = (added.body.item as DefinitionActionResult).targetId;
        const row = await stored(t, "site_components", card);
        expect(
          (row.blocks as { variants?: Record<string, { label: string }> })
            .variants?.[variantId]?.label
        ).toBe("Dark");
      });

      it("refuses an edit planned against a definition that has changed since", async () => {
        const t = await boot();
        const { card } = await site(t);
        const { cookie } = await holding(t, AUTHOR);
        const body: DefinitionActionRequest = {
          action: {
            kind: "rename-variant",
            variantId: "v-dark",
            label: "Night",
          },
        };
        const dry = await edit(cookie, card, { ...body, dryRun: true });
        const fingerprint = (dry.body.item as DefinitionActionResult)
          .fingerprint;

        await edit(cookie, card, {
          action: { kind: "add-variant", label: "Light" },
        });
        const applied = await edit(cookie, card, {
          ...body,
          expect: fingerprint,
        });

        expect(applied.status).toBe(409);
        const stored = (await t.nextly.findByID({
          collection: COMPONENTS_SLUG,
          id: card,
          overrideAccess: true,
          status: "all",
          draft: true,
          depth: 0,
        })) as unknown as {
          content: { variants: Record<string, { label: string }> };
        };
        expect(stored.content.variants["v-dark"]?.label).toBe("Dark");
      });

      it("publishes an edit when asked, and only for someone who may publish", async () => {
        const t = await boot();
        const { card } = await site(t);
        const publisher = await holding(t, AUTHOR);
        const drafter = await holding(
          t,
          AUTHOR.filter(slug => slug !== "publish-components")
        );
        const body: DefinitionActionRequest = {
          action: {
            kind: "rename-variant",
            variantId: "v-dark",
            label: "Night",
          },
          publish: true,
        };

        const refused = await edit(drafter.cookie, card, body);
        expect(refused.status).toBe(403);

        const published = await edit(publisher.cookie, card, body);
        expect(published.status).toBe(200);
        const live = (await t.nextly.findByID({
          collection: COMPONENTS_SLUG,
          id: card,
          overrideAccess: true,
          depth: 0,
        })) as unknown as {
          content: { variants: Record<string, { label: string }> };
        };
        expect(live.content.variants["v-dark"]?.label).toBe("Night");
      });
    });

    it("answers a save-as-pattern dry run without storing a pattern, refusals included", async () => {
      const t = await boot();
      const { cookie } = await holding(t, AUTHOR);
      const drafter = await holding(
        t,
        AUTHOR.filter(slug => slug !== "publish-patterns")
      );
      const count = async () =>
        (
          await t.nextly.find({
            collection: PATTERNS_SLUG,
            overrideAccess: true,
            status: "all",
          })
        ).items.length;
      const before = await count();

      const save = (as: string) =>
        post(as, ["save-as-pattern"], {
          document: {
            formatVersion: 1,
            kind: "page",
            nodes: [heading("a", "Saved")],
          },
          selectedIds: ["a"],
          fields: { title: "Saved", granularity: "section" },
          dryRun: true,
        });

      const dry = await save(cookie);
      expect(dry.status).toBe(200);
      expect(dry.body.item).toMatchObject({
        dryRun: true,
        pattern: { title: "Saved" },
        refusals: [],
      });
      // A saved pattern is published, which this author may not do: the dry
      // run says so rather than promising a save the site would refuse.
      const refused = await save(drafter.cookie);
      expect(refused.status).toBe(200);
      expect(
        (refused.body as unknown as SavePatternDryRunResponse).item.refusals
      ).not.toEqual([]);
      expect(await count()).toBe(before);
    });
  }
);
