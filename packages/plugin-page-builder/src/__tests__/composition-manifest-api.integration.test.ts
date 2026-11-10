/**
 * The composition manifest and the composition service, against a real
 * instance, through Nextly's own request handler with a session or an API key.
 *
 * What only a server shows: that the manifest a caller reads names every
 * component's fields and variants by the ids the actions take, so a variant
 * can be chosen with nothing but what the manifest said; that each part is
 * read as the caller, and a part they may not read is answered unreadable
 * rather than refusing the rest; and that another plugin's route reaching the
 * service runs the route's own checks as its caller, against this plugin's
 * collections rather than its own. Beside them, that every kind the manifest
 * lists is answered by its handler for a valid dry run, and that a templates
 * collection a host renamed is advertised, and addressed, by its new name.
 *
 * @module __tests__/composition-manifest-api.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  COMPONENT_INSTANCE_TYPE,
  ENTRY_CONTENT_TYPE,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  definePlugin,
  type PluginDefinition,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import { TEMPLATES_SLUG } from "../collections/templates";
import type {
  DefinitionActionResult,
  PageActionResult,
} from "../composition-actions-contract";
import {
  compositionManifestSchema,
  type CompositionManifest,
} from "../composition-manifest";
import {
  COMPOSITION_SERVICE,
  type CompositionService,
} from "../composition-service";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import { BLOCKS_TYPE } from "../fields/blocksField";
import {
  readLayoutSettings,
  writeLayoutSettings,
} from "../default-layout/store";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import type { TemplateActionResult } from "../templates/template-actions-contract";

import { call, created, holding, unique, person } from "./transfer-harness";

/** An author who may edit pages and read everything they compose from. */
const AUTHOR = [
  "read-pages",
  "update-pages",
  "read-patterns",
  "read-components",
  "read-layouts",
];

/**
 * Collections a template draws: the stories have one and an entry with its
 * own design, the notices a draft one with no Entry content block yet, and
 * the events none, so each template action has something it may act on.
 */
const STORIES = "cm_stories";
const NOTICES = "cm_notices";
const EVENTS = "cm_events";

/** The templates collection under the name a host gives it. */
const RENAMED_TEMPLATES = "site-templates";

/**
 * May reach every action route the manifest lists past its declared right,
 * and take every action on the fixtures the probe sets up: the definition
 * route asks `update-components` before it reads the body, and the address
 * action the routing permission, so a caller without them would never have
 * the action judged.
 */
const EVERY_ROUTE = [
  ...AUTHOR,
  "update-components",
  "read-templates",
  "create-templates",
  "update-templates",
  "publish-templates",
  "delete-templates",
  "manage-template-routing",
  `read-${STORIES}`,
  `read-${NOTICES}`,
  `read-${EVENTS}`,
];

/** A collection whose entries a template may draw: a `slug` and blocks. */
function drawnCollection(slug: string, blocks: readonly string[]) {
  return defineCollection({
    slug,
    status: true,
    access: { read: () => true },
    fields: [
      text({ name: "title" }),
      text({ name: "slug", unique: true }),
      text({ name: "blurb" }),
      ...blocks.map(name => ({ name, type: BLOCKS_TYPE }) as never),
    ],
  });
}

/** The path of each problem a schema refusal names; none for any other answer. */
function refusedPaths(answer: {
  status: number;
  body: Record<string, unknown>;
}): string[] {
  if (answer.status !== 400) return [];
  const error = answer.body.error as
    | { data?: { errors?: { path?: unknown }[] } }
    | undefined;
  return (error?.data?.errors ?? []).map(problem => String(problem.path));
}

/** The title marker of a page whose saves a failing side effect follows. */
const FAILING_MARK = "mailed";

/** The plugin standing in for another plugin's route, the MCP endpoint's say. */
const COMPOSER = "@t/composer";

/**
 * A plugin whose routes reach the composition service with their own
 * request's context, as a consumer of the service does.
 */
const composer = definePlugin({
  name: COMPOSER,
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    // A side effect after the commit that fails, as a mailer or a webhook
    // might, on a page whose title carries the marker: the save stands, and
    // the failure is reported beside it.
    ctx.hooks.on("afterUpdate", "pages", hook => {
      const { data, originalData } = hook as {
        data?: { title?: unknown };
        originalData?: { title?: unknown };
      };
      const title = String(data?.title ?? originalData?.title ?? "");
      if (title.includes(FAILING_MARK)) throw new Error("the mailer is down");
    });
  },
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/manifest",
        handler: async (req, ctx) => {
          const locale = new URL(req.url).searchParams.get("locale");
          return Response.json(
            await service(ctx).manifest(ctx, locale === null ? {} : { locale })
          );
        },
      },
      {
        method: "POST",
        path: "/page",
        handler: async (req, ctx) =>
          Response.json(
            await service(ctx).pageAction(ctx, (await req.json()) as never)
          ),
      },
      {
        method: "POST",
        path: "/definition/:id",
        handler: async (req, ctx) =>
          Response.json(
            await service(ctx).definitionAction(
              ctx,
              ctx.params.id ?? "",
              (await req.json()) as never
            )
          ),
      },
    ],
  },
});

function service(ctx: PluginRouteContext): CompositionService {
  return ctx.services.plugins[PAGE_BUILDER_PLUGIN_NAME]?.[
    COMPOSITION_SERVICE
  ] as CompositionService;
}

function heading(id: string, text: string): BlockNode {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

describe.each(getConfiguredTestDialects())(
  "the composition manifest and service (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** An instance with `plugin` as its page builder, the default one unless given. */
    async function boot(
      plugin: PluginDefinition = pageBuilder()
    ): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [plugin, composer],
        collections: [
          drawnCollection(STORIES, ["body", "sidebar"]),
          drawnCollection(NOTICES, ["body"]),
          drawnCollection(EVENTS, ["body"]),
        ],
        seedPublic: true,
      });
      // The instance's first user is its super admin, so it is made here and
      // never acts: every author below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    /** A page, a pattern, a card with a field and a variant, and a default Layout. */
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
            "v-light": { label: "Light", overrides: { title: "Light title" } },
          },
        },
      });
      const header = await created(t, COMPONENTS_SLUG, {
        title: "Header",
        slug: unique("header"),
        status: "published",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [heading("x", "Site")],
        },
      });
      const main = await created(t, LAYOUTS_SLUG, {
        title: "Main",
        slug: unique("main"),
        areas: [{ area: "header", component: header }],
        status: "published",
      });
      const slugs = {
        layouts: LAYOUTS_SLUG,
        settings: PAGE_BUILDER_SETTINGS_SLUG,
      };
      // Written against the settings as read, as every settings writer is.
      await writeLayoutSettings(
        t.nextly,
        slugs,
        await readLayoutSettings(t.nextly, slugs),
        { defaultLayout: main }
      );
      return { page, pattern, card, header, main };
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

    const manifestOf = async (
      as: string | { bearer: string },
      plugin?: string
    ): Promise<CompositionManifest> => {
      const read = await call(
        "GET",
        as,
        ["manifest"],
        plugin === undefined ? {} : { plugin }
      );
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      return compositionManifestSchema.parse(read.body);
    };

    it("describes patterns, components with their fields and variants, and Layouts, in its schema", async () => {
      const t = await boot();
      const { pattern, card, header, main } = await site(t);
      const { cookie } = await holding(t, AUTHOR);

      const manifest = await manifestOf(cookie);

      expect(manifest.collections).toEqual({
        pages: "pages",
        patterns: PATTERNS_SLUG,
        components: COMPONENTS_SLUG,
        componentField: "content",
        layouts: LAYOUTS_SLUG,
        templates: TEMPLATES_SLUG,
      });
      expect(manifest.patterns.readable).toBe(true);
      expect(manifest.patterns.items).toContainEqual({
        id: pattern,
        title: "Hero",
        granularity: "section",
      });
      const listed = manifest.components.items.find(item => item.id === card);
      expect(listed).toEqual({
        id: card,
        title: "Card",
        fields: [{ id: "title", label: "Title", type: "text" }],
        slots: [],
        variants: [
          { id: "v-dark", label: "Dark" },
          { id: "v-light", label: "Light" },
        ],
      });
      expect(
        manifest.components.items.find(item => item.id === header)?.variants
      ).toEqual([]);
      expect(manifest.layouts.defaultLayout).toBe(main);
      expect(manifest.layouts.items).toContainEqual({
        id: main,
        title: "Main",
        published: true,
        isDefault: true,
        regions: [{ area: "header", componentId: header }],
      });
      expect(manifest.actions.map(action => action.name)).toEqual([
        "pageAction",
        "definitionAction",
        "templateAction",
      ]);
      expect(manifest.actions[0]?.kinds).toContain("choose-variant");
    });

    it("chooses a variant using only ids read from the manifest", async () => {
      const t = await boot();
      const { page } = await site(t);
      const { cookie } = await holding(t, AUTHOR);

      const manifest = await manifestOf(cookie);
      const card = manifest.components.items.find(
        item => item.title === "Card"
      );
      const light = card?.variants.find(variant => variant.label === "Light");
      const field = card?.fields.find(item => item.label === "Title");
      if (card === undefined || light === undefined || field === undefined) {
        throw new Error("the manifest did not list the card's variant");
      }
      const at = { collection: manifest.collections.pages, id: page };

      const placed = await call("POST", cookie, ["pages", "actions"], {
        body: {
          page: at,
          action: { kind: "place-component", componentId: card.id },
        },
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(200);
      const instanceId =
        (placed.body.item as PageActionResult).insertedId ?? "";
      const chosen = await call("POST", cookie, ["pages", "actions"], {
        body: {
          page: at,
          action: { kind: "choose-variant", instanceId, variant: light.id },
        },
      });
      expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
      const valued = await call("POST", cookie, ["pages", "actions"], {
        body: {
          page: at,
          action: {
            kind: "set-placement-values",
            instanceId,
            values: { [field.id]: "Mine" },
          },
        },
      });
      expect(valued.status, JSON.stringify(valued.body)).toBe(200);

      const nodes = (
        (await stored(t, "pages", page)).content as { nodes: BlockNode[] }
      ).nodes;
      expect(nodes[1]?.props).toEqual({
        componentId: card.id,
        variant: light.id,
        overrides: { [field.id]: "Mine" },
      });
    });

    /**
     * What the probe acts on, beside the site: a page placing the card and
     * listing the stories; the stories' published template, with a bound
     * heading and an Entry content block, and one story's own design; the
     * notices' draft template, with no Entry content block; and a panel
     * component exposing a field and a slot.
     */
    async function probed(t: TestNextly, card: string, cookie: string) {
      const page = await created(t, "pages", {
        title: "Probe",
        slug: unique("probe"),
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            // Shown on a condition, so clearing its conditions changes it.
            {
              ...heading("lead", "Lead"),
              visibility: { conditions: [[{ field: "title", op: "exists" }]] },
            },
            {
              id: "inst",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: card },
            },
            {
              id: "list",
              type: "core/collection-loop",
              version: 1,
              props: { collection: STORIES, limit: 3 },
              slots: { children: [heading("item", "Item")] },
            },
          ],
        },
      });
      const story = (slug: string) =>
        created(t, STORIES, {
          title: slug,
          slug,
          blurb: `${slug} blurb`,
          status: "published",
        });
      const first = await story("first");
      const second = await story("second");
      const stories = await created(t, TEMPLATES_SLUG, {
        title: "Story page",
        collection: STORIES,
        status: "published",
        content: {
          formatVersion: 1,
          kind: "template",
          nodes: [
            {
              ...heading("bound", "Title"),
              bindings: { text: { $bind: "title" } },
            },
            heading("free", "Free"),
            {
              id: "ec",
              type: ENTRY_CONTENT_TYPE,
              version: 1,
              props: { field: "body" },
            },
          ],
        },
      });
      const notices = await created(t, TEMPLATES_SLUG, {
        title: "Notice page",
        collection: NOTICES,
        content: { formatVersion: 1, kind: "template", nodes: [] },
      });
      // The second story's own design, given the way a client gives one, so
      // there is one to remove.
      const given = await call("POST", cookie, ["templates", "actions"], {
        body: {
          action: {
            kind: "give-entry-design",
            collection: STORIES,
            entry: second,
          },
        },
      });
      expect(given.status, JSON.stringify(given.body)).toBe(200);
      const panel = await created(t, COMPONENTS_SLUG, {
        title: "Panel",
        slug: unique("panel"),
        status: "published",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            heading("p1", "Panel label"),
            heading("p2", "Panel note"),
            {
              id: "b",
              type: "core/box",
              version: 1,
              props: {},
              slots: { children: [] },
            },
          ],
          exposed: [
            {
              id: "label",
              label: "Label",
              nodeId: "p1",
              propPath: "text",
              type: "text",
            },
          ],
          slots: { body: { label: "Body", nodeId: "b", slot: "children" } },
        },
      });
      return { page, first, second, stories, notices, panel };
    }

    it("answers every kind it lists: a valid dry run of each is judged by its handler", async () => {
      const t = await boot();
      const { pattern, card, main } = await site(t);
      const { cookie } = await holding(t, EVERY_ROUTE);
      const { page, first, second, stories, notices, panel } = await probed(
        t,
        card,
        cookie
      );
      const manifest = await manifestOf(cookie);
      const templates = manifest.collections.templates ?? TEMPLATES_SLUG;
      const onPage = { collection: manifest.collections.pages, id: page };
      const onStories = { collection: templates, id: stories };
      const onNotices = { collection: templates, id: notices };

      /**
       * One minimal valid dry run of each kind, against what the fixtures
       * hold. Every one is expected to preview cleanly (a `200` dry run with
       * no refusals): each names a target that exists and an action the site
       * accepts, so anything else is the handler failing a kind a client was
       * told it may send.
       */
      type Probe = {
        readonly route: CompositionManifest["actions"][number]["name"];
        readonly action: { readonly kind: string } & Record<string, unknown>;
        /** The page a page action edits. */
        readonly page?: { collection: string; id: string };
        /** The component a definition action edits, the card unless named. */
        readonly component?: string;
      };
      const probes: readonly Probe[] = [
        {
          route: "pageAction",
          page: onPage,
          action: { kind: "insert-pattern", patternId: pattern },
        },
        {
          route: "pageAction",
          page: onPage,
          action: { kind: "place-component", componentId: card },
        },
        {
          route: "pageAction",
          page: onPage,
          action: {
            kind: "set-placement-values",
            instanceId: "inst",
            values: { title: "Mine" },
          },
        },
        {
          route: "pageAction",
          page: onPage,
          action: {
            kind: "choose-variant",
            instanceId: "inst",
            variant: "v-dark",
          },
        },
        {
          route: "pageAction",
          page: onPage,
          action: {
            kind: "set-list-query",
            listId: "list",
            query: { limit: 5 },
          },
        },
        {
          route: "pageAction",
          page: onPage,
          action: { kind: "set-conditions", nodeId: "lead", conditions: null },
        },
        {
          route: "pageAction",
          page: onStories,
          action: {
            kind: "bind-prop",
            nodeId: "free",
            prop: "text",
            binding: { $bind: "blurb" },
          },
        },
        {
          route: "pageAction",
          page: onStories,
          action: {
            kind: "unbind-prop",
            nodeId: "bound",
            prop: "text",
            keep: { value: "Kept title" },
          },
        },
        {
          route: "pageAction",
          page: onPage,
          action: { kind: "set-layout", layout: main },
        },
        {
          route: "pageAction",
          page: onNotices,
          action: { kind: "place-entry-content", field: "body" },
        },
        {
          route: "pageAction",
          page: onStories,
          action: {
            kind: "set-entry-content-field",
            nodeId: "ec",
            field: "sidebar",
          },
        },
        {
          route: "definitionAction",
          component: panel,
          action: {
            kind: "expose",
            label: "Note",
            nodeId: "p2",
            propPath: "text",
          },
        },
        {
          route: "definitionAction",
          action: {
            kind: "rename-exposure",
            exposureId: "title",
            label: "Heading",
          },
        },
        {
          route: "definitionAction",
          component: panel,
          action: {
            kind: "retarget-exposure",
            exposureId: "label",
            nodeId: "p2",
            propPath: "text",
          },
        },
        {
          route: "definitionAction",
          action: { kind: "remove-exposure", exposureId: "title" },
        },
        {
          route: "definitionAction",
          component: panel,
          action: { kind: "remove-exposed-slot", slotId: "body" },
        },
        {
          route: "definitionAction",
          action: { kind: "add-variant", label: "Night" },
        },
        {
          route: "definitionAction",
          action: {
            kind: "rename-variant",
            variantId: "v-dark",
            label: "Night",
          },
        },
        {
          route: "definitionAction",
          action: { kind: "delete-variant", variantId: "v-light" },
        },
        {
          route: "definitionAction",
          action: {
            kind: "set-variant-value",
            variantId: "v-dark",
            exposureId: "title",
            value: "Night title",
          },
        },
        {
          route: "definitionAction",
          action: {
            kind: "reset-variant-value",
            variantId: "v-dark",
            exposureId: "title",
          },
        },
        {
          route: "templateAction",
          action: { kind: "create-template", collection: EVENTS },
        },
        {
          route: "templateAction",
          action: { kind: "publish-template", id: notices },
        },
        {
          route: "templateAction",
          action: {
            kind: "give-entry-design",
            collection: STORIES,
            entry: first,
          },
        },
        {
          route: "templateAction",
          action: {
            kind: "remove-entry-design",
            collection: STORIES,
            entry: second,
          },
        },
        {
          route: "templateAction",
          action: { kind: "delete-template", id: notices },
        },
        {
          route: "templateAction",
          action: {
            kind: "set-template-address",
            id: stories,
            address: "/probe-stories",
          },
        },
      ];

      // The table covers exactly what the live manifest advertises: a kind
      // added to a route with no entry here fails, rather than going
      // unprobed, and so does an entry for a kind no route lists any more.
      const named = (route: string, kind: string) => `${route} ${kind}`;
      expect(manifest.actions).toHaveLength(3);
      expect(
        probes.map(probe => named(probe.route, probe.action.kind)).sort()
      ).toEqual(
        manifest.actions
          .flatMap(action => action.kinds.map(kind => named(action.name, kind)))
          .sort()
      );

      const routeOf = (name: Probe["route"], component: string) => {
        const action = manifest.actions.find(listed => listed.name === name);
        if (action === undefined) {
          throw new Error(`the manifest lists no ${name} route`);
        }
        return action.path.replace(":id", component).split("/").filter(Boolean);
      };
      const dryRun = (probe: Probe) =>
        call("POST", cookie, routeOf(probe.route, probe.component ?? card), {
          body: {
            ...(probe.page === undefined ? {} : { page: probe.page }),
            action: probe.action,
            dryRun: true,
          },
        });

      // The control, on every route: a kind it does not have is refused by
      // its schema at `action.kind`, before any handler runs, so a listed
      // kind the schema did not know would be seen below.
      for (const action of manifest.actions) {
        const unknown = await dryRun({
          route: action.name,
          action: { kind: "no-such-kind" },
          ...(action.name === "pageAction" ? { page: onPage } : {}),
        });
        expect(unknown.status, JSON.stringify(unknown.body)).toBe(400);
        expect(refusedPaths(unknown)).toContain("action.kind");
      }

      for (const probe of probes) {
        const answer = await dryRun(probe);
        const said = `${named(probe.route, probe.action.kind)}: ${String(answer.status)} ${JSON.stringify(answer.body)}`;
        // Reached as a caller the route admits, and answered rather than
        // failing: a kind whose handler throws is not one a client can use.
        expect([401, 403], said).not.toContain(answer.status);
        expect(answer.status, said).toBeLessThan(500);
        // Past the schema: no part of the action refused as missing or
        // malformed, so the answer below is the handler's.
        expect(
          refusedPaths(answer).filter(
            path => path === "action" || path.startsWith("action.")
          ),
          said
        ).toEqual([]);
        // Judged by the handler as a dry run, and judged acceptable.
        expect(answer.status, said).toBe(200);
        const item = answer.body.item as {
          dryRun?: unknown;
          refusals?: unknown;
        };
        expect(item.dryRun, said).toBe(true);
        expect(item.refusals, said).toEqual([]);
      }
    }, 60_000);

    it("names a renamed templates collection, and reaches a template under that name only", async () => {
      const plugin = pageBuilder();
      if (plugin.rename === undefined) {
        throw new Error("the page builder offers no rename");
      }
      const t = await boot(
        plugin.rename({ [TEMPLATES_SLUG]: RENAMED_TEMPLATES })
      );
      const { cookie } = await holding(t, [
        ...AUTHOR,
        `read-${RENAMED_TEMPLATES}`,
        `create-${RENAMED_TEMPLATES}`,
        `update-${RENAMED_TEMPLATES}`,
        `read-${NOTICES}`,
      ]);

      const manifest = await manifestOf(cookie);
      expect(manifest.collections.templates).toBe(RENAMED_TEMPLATES);

      const made = await call("POST", cookie, ["templates", "actions"], {
        body: { action: { kind: "create-template", collection: NOTICES } },
      });
      expect(made.status, JSON.stringify(made.body)).toBe(200);
      const id = (made.body.item as TemplateActionResult).template?.id ?? "";
      expect(id).not.toBe("");
      const before = await stored(t, RENAMED_TEMPLATES, id);
      expect(before.collection).toBe(NOTICES);

      const action = { kind: "place-entry-content", field: "body" };
      // The default slug names no collection here, so it addresses nothing:
      // a client that ignored the manifest is refused, and nothing is written.
      const unnamed = await call("POST", cookie, ["pages", "actions"], {
        body: { page: { collection: TEMPLATES_SLUG, id }, action },
      });
      expect([403, 404], JSON.stringify(unnamed.body)).toContain(
        unnamed.status
      );
      expect(await stored(t, RENAMED_TEMPLATES, id)).toEqual(before);

      // The slug the manifest names reaches the template, and the write
      // lands on it.
      const placed = await call("POST", cookie, ["pages", "actions"], {
        body: {
          page: { collection: manifest.collections.templates, id },
          action,
        },
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(200);
      const result = placed.body.item as PageActionResult;
      expect(result.page).toEqual({ collection: RENAMED_TEMPLATES, id });
      const nodes = (
        (await stored(t, RENAMED_TEMPLATES, id)).content as {
          nodes: BlockNode[];
        }
      ).nodes;
      expect(nodes).toEqual([
        expect.objectContaining({
          id: result.insertedId,
          type: ENTRY_CONTENT_TYPE,
          props: { field: "body" },
        }),
      ]);
    });

    it("answers a part the caller may not read as unreadable, and the rest as read", async () => {
      const t = await boot();
      await site(t);
      const { cookie } = await holding(t, [
        "read-pages",
        "update-pages",
        "read-components",
      ]);

      const manifest = await manifestOf(cookie);

      expect(manifest.components.readable).toBe(true);
      expect(manifest.components.items).not.toEqual([]);
      expect(manifest.layouts).toEqual({
        readable: false,
        items: [],
        truncated: false,
        defaultLayout: null,
      });
      expect(manifest.patterns).toEqual({
        readable: false,
        items: [],
        truncated: false,
      });
    });

    it("serves another plugin's route through the service, as that route's caller", async () => {
      const t = await boot();
      const { page, card } = await site(t);
      const { cookie } = await holding(t, AUTHOR);

      // The manifest names this plugin's collections, though the route
      // reaching it belongs to a plugin that contributes none.
      expect(await manifestOf(cookie, COMPOSER)).toEqual(
        await manifestOf(cookie)
      );

      const request = {
        page: { collection: "pages", id: page },
        action: {
          kind: "place-component",
          componentId: card,
          variant: "v-dark",
        },
      };
      const dry = await call("POST", cookie, ["page"], {
        plugin: COMPOSER,
        body: { ...request, dryRun: true },
      });
      expect(dry.status, JSON.stringify(dry.body)).toBe(200);
      const preview = dry.body.item as PageActionResult;
      expect(preview.dryRun).toBe(true);
      expect(preview.refusals).toEqual([]);
      expect(
        ((await stored(t, "pages", page)).content as { nodes: BlockNode[] })
          .nodes
      ).toHaveLength(1);

      const applied = await call("POST", cookie, ["page"], {
        plugin: COMPOSER,
        body: { ...request, expect: preview.fingerprint },
      });
      expect(applied.status, JSON.stringify(applied.body)).toBe(200);
      expect(applied.body.message).toBe("The page was changed.");
      expect(
        ((await stored(t, "pages", page)).content as { nodes: BlockNode[] })
          .nodes[1]?.props
      ).toEqual({ componentId: card, variant: "v-dark" });
    });

    it("refuses through the service what the routes refuse the same caller", async () => {
      const t = await boot();
      const { page, card } = await site(t);
      // May read everything and change nothing.
      const { cookie } = await holding(t, [
        "read-pages",
        "read-components",
        "read-layouts",
      ]);
      const before = await stored(t, COMPONENTS_SLUG, card);

      const placed = await call("POST", cookie, ["page"], {
        plugin: COMPOSER,
        body: {
          page: { collection: "pages", id: page },
          action: { kind: "place-component", componentId: card },
        },
      });
      expect(placed.status).toBe(403);

      // The definition route declares update on components, so its dispatch
      // turns this caller away before a dry run is judged. The service asks
      // it too: without that, the dry run would read the component and
      // answer the write's refusal as a 200 preview.
      const edit = {
        action: { kind: "add-variant", label: "Night" },
        dryRun: true,
      };
      const routed = await call(
        "POST",
        cookie,
        ["components", card, "definition"],
        { body: edit }
      );
      expect(routed.status).toBe(403);
      const served = await call("POST", cookie, ["definition", card], {
        plugin: COMPOSER,
        body: edit,
      });
      expect(served.status, JSON.stringify(served.body)).toBe(403);
      expect(await stored(t, COMPONENTS_SLUG, card)).toEqual(before);

      // A language no route would take is refused by the service as well.
      const longLocale = "x".repeat(36);
      expect(
        (
          await call("GET", cookie, ["manifest"], {
            query: `?locale=${longLocale}`,
          })
        ).status
      ).toBe(400);
      expect(
        (
          await call("GET", cookie, ["manifest"], {
            plugin: COMPOSER,
            query: `?locale=${longLocale}`,
          })
        ).status
      ).toBe(400);

      // The route's right is asked before the request is read, by the route
      // and the service alike: a refused caller learns nothing of the parse.
      const unreadable = { action: { kind: "no-such-edit" } };
      expect(
        (
          await call("POST", cookie, ["components", card, "definition"], {
            body: unreadable,
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call("POST", cookie, ["definition", card], {
            plugin: COMPOSER,
            body: unreadable,
          })
        ).status
      ).toBe(403);

      // A request the route's schema refuses is refused by the service too.
      const malformed = await call("POST", cookie, ["page"], {
        plugin: COMPOSER,
        body: {
          page: { collection: "pages", id: page },
          action: { kind: "delete-everything" },
        },
      });
      expect(malformed.status).toBe(400);
    });

    it("tells a caller of the service of a side effect that failed after the commit", async () => {
      const t = await boot();
      const { card } = await site(t);
      const page = await created(t, "pages", {
        title: `Home, ${FAILING_MARK}`,
        slug: unique("mailed"),
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("lead", "Lead")],
        },
      });
      const { cookie } = await holding(t, AUTHOR);

      const placed = await call("POST", cookie, ["page"], {
        plugin: COMPOSER,
        body: {
          page: { collection: "pages", id: page },
          action: { kind: "place-component", componentId: card },
        },
      });

      // The write is durable, so it is a success, with the failure beside it
      // rather than lost: a caller told only "changed" would not know a mail
      // never went, and one told "failed" would place the card twice.
      expect(placed.status, JSON.stringify(placed.body)).toBe(200);
      expect(placed.body.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "failure",
            phase: "afterUpdate",
            collection: "pages",
          }),
        ])
      );
      expect(
        ((await stored(t, "pages", page)).content as { nodes: BlockNode[] })
          .nodes
      ).toHaveLength(2);
    });

    it("edits a definition through the service and reports an API key as the key", async () => {
      const t = await boot();
      const { card } = await site(t);
      const { id: owner } = await holding(t, [
        "read-components",
        "update-components",
      ]);
      const made = await t.nextly.apiKeys.create({
        userId: owner,
        name: "agent",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });

      const edited = await call(
        "POST",
        { bearer: made.key },
        ["definition", card],
        {
          plugin: COMPOSER,
          body: { action: { kind: "add-variant", label: "Night" } },
        }
      );

      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const result = edited.body.item as DefinitionActionResult;
      expect(result.by).toEqual({
        kind: "api-key",
        userId: owner,
        apiKeyId: made.doc.id,
      });
      // An id past the bound is refused alike, by the route and the service.
      const overlong = "c".repeat(513);
      const add = { action: { kind: "add-variant", label: "Night" } };
      const routed = await call(
        "POST",
        { bearer: made.key },
        ["components", overlong, "definition"],
        { body: add }
      );
      expect(routed.status, JSON.stringify(routed.body)).toBe(400);
      const served = await call(
        "POST",
        { bearer: made.key },
        ["definition", overlong],
        { plugin: COMPOSER, body: add }
      );
      expect(served.status, JSON.stringify(served.body)).toBe(400);

      const variants = (
        (await stored(t, COMPONENTS_SLUG, card)).content as {
          variants: Record<string, { label: string }>;
        }
      ).variants;
      expect(variants[result.targetId]?.label).toBe("Night");
    });
  }
);
