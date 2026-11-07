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
 * collections rather than its own.
 *
 * @module __tests__/composition-manifest-api.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { type BlockNode } from "@nextlyhq/blocks-engine";
import { definePlugin, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
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
import {
  readLayoutSettings,
  writeLayoutSettings,
} from "../default-layout/store";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

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
 * May reach every action route the manifest lists past its declared right:
 * the definition route asks `update-components` before it reads the body,
 * so a caller without it would never have the action's kind judged.
 */
const EVERY_ROUTE = [
  ...AUTHOR,
  "update-components",
  "read-templates",
  "create-templates",
  "update-templates",
  "publish-templates",
  "delete-templates",
];

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

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), composer],
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

    it("takes every kind it lists: a dry run of each is never refused as an unknown kind", async () => {
      const t = await boot();
      const { page, card } = await site(t);
      const { cookie } = await holding(t, EVERY_ROUTE);
      const manifest = await manifestOf(cookie);

      // Each kind alone, with none of the fields it needs: what is judged is
      // whether the route knows the kind, which its schema answers before
      // anything else about the action, as a refusal at `action.kind`.
      const dryRun = (
        action: CompositionManifest["actions"][number],
        kind: string
      ) =>
        call(
          "POST",
          cookie,
          action.path.replace(":id", card).split("/").filter(Boolean),
          {
            body: {
              ...(action.name === "pageAction"
                ? { page: { collection: manifest.collections.pages, id: page } }
                : {}),
              action: { kind },
              dryRun: true,
            },
          }
        );

      // The control, on every route: a kind it does not have is refused at
      // `action.kind`, so a route that did not know a listed kind would be
      // seen below rather than pass as some other refusal.
      expect(manifest.actions).toHaveLength(3);
      for (const action of manifest.actions) {
        const unknown = await dryRun(action, "no-such-kind");
        expect(unknown.status, JSON.stringify(unknown.body)).toBe(400);
        expect(refusedPaths(unknown)).toContain("action.kind");
      }

      for (const action of manifest.actions) {
        expect(action.kinds.length, action.name).toBeGreaterThan(0);
        for (const kind of action.kinds) {
          const answer = await dryRun(action, kind);
          const said = `${action.name} ${kind}: ${String(answer.status)} ${JSON.stringify(answer.body)}`;
          // Reached as a caller the route admits, so its body was read, and
          // answered rather than failing: a kind whose handler throws is not
          // one a client can use, whatever the manifest says.
          expect([401, 403], said).not.toContain(answer.status);
          expect(answer.status, said).toBeLessThan(500);
          // Refused for a missing id or field, or judged by a dry run: any
          // answer but the route not knowing the kind.
          expect(refusedPaths(answer), said).not.toContain("action.kind");
        }
      }
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
