/**
 * A collection list whose source is a named query, end to end against a real
 * instance: registered through `pageBuilder({ namedQueries })`, set on a
 * list through the API and through the composition service a plugin reaches,
 * judged as an editor save is, listed by the manifest and the editor's route
 * without its run function, and drawn as a published page draws it.
 *
 * What only a server shows: that the save refuses a list missing a required
 * input, a query the site does not register, a value an input does not take
 * and a custom source beside a collection, in the editor's words, and keeps
 * a stored list whose query was since removed; that choosing a custom source
 * clears the collection, filters and sort in one write; and that a field the
 * public may not read never reaches the HTML, whether the query's rows are a
 * collection's entries or rows it builds itself, nor a draft, nor anything a
 * trusted Direct API call inside `run` would have read.
 *
 * @module __tests__/named-query-source.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  defineNamedQuery,
  param,
  type BlockNode,
  type NamedQueryDefinition,
} from "@nextlyhq/blocks-engine";
import {
  createBlockResolver,
  createQueryBudget,
  createStandaloneContext,
  PageRenderer,
  type NamedQueryFailure,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  definePlugin,
  getCachedNextly,
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
import {
  bindingFieldShapes,
  createPublicReader,
  openNamedQueryFrame,
} from "nextly/runtime";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ListQueryChange,
  PageActionResult,
} from "../composition-actions-contract";
import type { CompositionManifest } from "../composition-manifest";
import {
  COMPOSITION_SERVICE,
  type CompositionService,
} from "../composition-service";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import type { NamedQueryItem } from "../named-queries-contract";
import { namedQueriesOf, pageBuilder } from "../plugin";

import {
  call,
  created,
  holding,
  person,
  post,
  unique,
} from "./transfer-harness";

const EVENTS = "nq_events";
const SENTINEL = "INTERNAL-SENTINEL-7Q";

const AUTHOR = ["read-pages", "update-pages", `read-${EVENTS}`];

/** Upcoming events: rows of its own schema, keyed by id, needing a city. */
const upcoming = defineNamedQuery({
  name: "events.upcoming",
  label: "Upcoming events",
  params: {
    city: param.choice({
      label: "City",
      required: true,
      options: [
        { value: "lahore", label: "Lahore" },
        { value: "karachi", label: "Karachi" },
      ],
    }),
    within: param.number({ label: "Within", integer: true, min: 1, max: 9 }),
  },
  reads: { collections: [EVENTS] },
  rows: {
    key: "id",
    fields: [
      { name: "id", type: "text" },
      { name: "title", type: "text" },
      { name: "note", type: "text" },
    ],
  },
  total: true,
  async run({ params, reader, window }) {
    const read = await reader.find({
      collection: EVENTS,
      filters: [{ field: "city", op: "equals", value: params.city }],
      sort: ["title"],
      limit: window.limit,
      offset: window.offset,
    });
    // Copies the protected field into a declared one: the reader never
    // returns it, so the copy holds nothing.
    return {
      rows: read.items.map(item => ({
        id: String(item.id),
        title: item.title,
        note: item.internalNote,
      })),
      total: read.meta.total,
    };
  },
});

/** Every event, as the collection's own entries. */
const allEvents = defineNamedQuery({
  name: "events.all",
  label: "All events",
  reads: { collections: [EVENTS] },
  rows: { collection: EVENTS },
  async run({ reader, window }) {
    return {
      rows: (
        await reader.find({
          collection: EVENTS,
          sort: ["title"],
          limit: window.limit,
        })
      ).items,
    };
  },
});

/** A query whose run reaches past its reader for the trusted Direct API. */
const trusted = defineNamedQuery({
  name: "events.trusted",
  label: "Trusted events",
  reads: { collections: [EVENTS] },
  rows: { collection: EVENTS },
  async run() {
    const nextly = await getCachedNextly();
    const read = await nextly.find({ collection: EVENTS, depth: 0 });
    return { rows: read.items as Record<string, unknown>[] };
  },
});

/**
 * A plugin whose route reaches the composition service with its own
 * request's context, as a plugin consumer does.
 */
const composer = definePlugin({
  name: "@t/nq-composer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/page",
        handler: async (req, ctx: PluginRouteContext) =>
          Response.json(
            await (
              ctx.services.plugins[PAGE_BUILDER_PLUGIN_NAME]?.[
                COMPOSITION_SERVICE
              ] as CompositionService
            ).pageAction(ctx, (await req.json()) as never)
          ),
      },
    ],
  },
});

function list(id: string, props: Record<string, unknown>): BlockNode {
  const heading = (headingId: string, field: string): BlockNode =>
    ({
      id: headingId,
      type: "core/heading",
      version: 1,
      props: { text: "-", level: "h3" },
      bindings: { text: { $bind: field, source: "item" } },
    }) as BlockNode;
  return {
    id,
    type: "core/collection-loop",
    version: 1,
    props,
    slots: {
      children: [
        heading(`${id}-title`, "title"),
        heading(`${id}-note`, "note"),
      ],
      empty: [],
    },
  };
}

function page(...nodes: BlockNode[]) {
  return { formatVersion: 1, kind: "page", nodes };
}

/** The page builder the current test booted, whose queries its site reads. */
let builder: PluginDefinition;

/** A page drawn as a published page draws it, with the failures it logged. */
async function published(
  t: TestNextly,
  nodes: BlockNode[]
): Promise<{ html: string; failures: NamedQueryFailure[] }> {
  const failures: NamedQueryFailure[] = [];
  const reader = createPublicReader(t.nextly);
  const stream = await renderToReadableStream(
    createElement(PageRenderer, {
      document: page(...nodes) as never,
      blocks: createBlockResolver(coreBlocks),
      context: {
        ...createStandaloneContext(),
        queries: createQueryBudget(),
        namedQueries: {
          // This site's own queries, as its published route is handed them.
          definitionOf: name => namedQueriesOf(builder).definitionOf(name),
          reader,
          today: () => Promise.resolve("2026-11-06"),
          // The public's fields of a collection, as a published page's
          // route answers them: a collection's entries are kept to these.
          fieldsOf: collection => bindingFieldShapes({ collection }),
          frame: name => openNamedQueryFrame(name),
          report: failure => failures.push(failure),
        },
      },
      bindings: {},
    })
  );
  await stream.allReady;
  return { html: await new Response(stream).text(), failures };
}

describe.each(getConfiguredTestDialects())(
  "a named query as a list's source (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [
          (builder = pageBuilder({
            namedQueries: [upcoming, allEvents, trusted],
          })),
          composer,
        ],
        collections: [
          defineCollection({
            slug: EVENTS,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "city" }),
              text({ name: "internalNote", access: { read: () => false } }),
            ],
          }),
        ],
        seedPublic: true,
      });
      await person(current, "owner");
      for (const [title, city, status] of [
        ["Alpha", "lahore", "published"],
        ["Beta", "lahore", "published"],
        ["Gamma", "karachi", "published"],
        ["Draft", "lahore", "draft"],
      ] as const) {
        await current.nextly.create({
          collection: EVENTS,
          data: { title, city, internalNote: SENTINEL, status },
          overrideAccess: true,
        });
      }
      return current;
    }

    async function storedProps(
      t: TestNextly,
      id: string
    ): Promise<Record<string, unknown> | undefined> {
      const row = (await t.nextly.findByID({
        collection: "pages",
        id,
        overrideAccess: true,
        status: "all",
        draft: true,
        depth: 0,
      })) as unknown as { content: { nodes: BlockNode[] } };
      return row.content.nodes.find(node => node.id === "list")?.props;
    }

    async function homePage(t: TestNextly, props: Record<string, unknown>) {
      return created(t, "pages", {
        title: "Home",
        slug: unique("home"),
        content: page(list("list", props)),
      });
    }

    const change = (
      cookie: string,
      id: string,
      query: ListQueryChange,
      extra: { dryRun?: boolean } = {}
    ) =>
      post(cookie, ["pages", "actions"], {
        page: { collection: "pages", id },
        action: { kind: "set-list-query", listId: "list", query },
        ...(extra.dryRun === true ? { dryRun: true } : {}),
      });

    it("registers the site's queries, handed to the route that renders its pages", async () => {
      await boot();
      const lookup = (name: string) =>
        namedQueriesOf(builder).definitionOf(name);
      expect(lookup("events.upcoming")).toBe(upcoming);
      expect(lookup("events.trusted")).toBe(trusted);
      expect(lookup("events.gone")).toBeUndefined();
    });

    it("sets a custom source, clearing the collection, filters and sort in one write", async () => {
      const t = await boot();
      const id = await homePage(t, {
        collection: EVENTS,
        filters: [{ field: "title", op: "exists", value: true }],
        sort: "-title",
        limit: 5,
      });
      const { cookie } = await holding(t, AUTHOR);
      const set = await change(cookie, id, {
        namedQuery: { name: "events.upcoming", params: { city: "lahore" } },
      });
      expect(set.status).toBe(200);
      expect(await storedProps(t, id)).toEqual({
        namedQuery: { name: "events.upcoming", params: { city: "lahore" } },
        limit: 5,
      });
      // Choosing a collection again removes the custom source.
      const back = await change(cookie, id, { collection: EVENTS });
      expect(back.status).toBe(200);
      expect(await storedProps(t, id)).toEqual({
        collection: EVENTS,
        limit: 5,
      });
    });

    it.each<[string, ListQueryChange, string]>([
      [
        "a custom source missing a required input",
        { namedQuery: { name: "events.upcoming", params: {} } },
        "Choose a city. Upcoming events needs one to run.",
      ],
      [
        "a query the site does not register",
        { namedQuery: { name: "events.gone" } },
        '"events.gone" isn\'t set up on this site any more',
      ],
      [
        "an input value the query does not take",
        {
          namedQuery: {
            name: "events.upcoming",
            params: { city: "lahore", within: 40 },
          },
        },
        "Enter a whole number from 1 to 9.",
      ],
      [
        "a custom source's list split into pages",
        {
          namedQuery: { name: "events.upcoming", params: { city: "lahore" } },
          paginate: true,
        },
        "A custom source's list can't be split into pages yet.",
      ],
      [
        "a custom source beside a collection",
        {
          namedQuery: { name: "events.upcoming", params: { city: "lahore" } },
          collection: EVENTS,
        },
        "can't also name a collection, related entries, filters or sort",
      ],
    ])(
      "refuses %s: the dry run says so, and the apply writes nothing",
      async (_case, query, says) => {
        const t = await boot();
        const id = await homePage(t, { collection: EVENTS });
        const { cookie } = await holding(t, AUTHOR);
        const dry = await change(cookie, id, query, { dryRun: true });
        const said =
          dry.status === 200
            ? (dry.body.item as PageActionResult).refusals.join("\n")
            : JSON.stringify(dry.body);
        expect(said).toContain(says);
        const applied = await change(cookie, id, query);
        expect(applied.status).toBe(422);
        expect(await storedProps(t, id)).toEqual({ collection: EVENTS });
      }
    );

    it("takes a custom source sent beside empty or removed source parts", async () => {
      const t = await boot();
      const id = await homePage(t, {
        collection: EVENTS,
        sort: "-title",
        limit: 5,
      });
      const { cookie } = await holding(t, AUTHOR);
      const set = await change(cookie, id, {
        namedQuery: { name: "events.upcoming", params: { city: "lahore" } },
        collection: "",
        filters: [],
        sort: "",
        relation: null,
      });
      expect(set.status).toBe(200);
      // The empty parts are left out with the source they stood for.
      expect(await storedProps(t, id)).toEqual({
        namedQuery: { name: "events.upcoming", params: { city: "lahore" } },
        limit: 5,
      });
    });

    it("sets and refuses a custom source through the composition service a plugin reaches", async () => {
      const t = await boot();
      const id = await homePage(t, { collection: EVENTS });
      const { cookie } = await holding(t, AUTHOR);
      const through = (query: ListQueryChange, dryRun = false) =>
        call("POST", cookie, ["page"], {
          plugin: "@t/nq-composer",
          body: {
            page: { collection: "pages", id },
            action: { kind: "set-list-query", listId: "list", query },
            ...(dryRun ? { dryRun: true } : {}),
          },
        });
      const refused = await through(
        { namedQuery: { name: "events.upcoming" } },
        true
      );
      expect(JSON.stringify(refused.body)).toContain(
        "Choose a city. Upcoming events needs one to run."
      );
      const set = await through({
        namedQuery: { name: "events.upcoming", params: { city: "karachi" } },
      });
      expect(set.status).toBe(200);
      expect(await storedProps(t, id)).toEqual({
        namedQuery: { name: "events.upcoming", params: { city: "karachi" } },
      });
    });

    it("lists the queries without their run functions, to the editor and in the manifest", async () => {
      const t = await boot();
      const { cookie } = await holding(t, [
        ...AUTHOR,
        "read-patterns",
        "read-components",
        "read-layouts",
      ]);
      const listed = await call("GET", cookie, ["named-queries"]);
      expect(listed.status).toBe(200);
      const items = listed.body.items as NamedQueryItem[];
      expect(items.map(item => item.name)).toEqual([
        "events.upcoming",
        "events.all",
        "events.trusted",
      ]);
      expect(items[0]).toMatchObject({
        label: "Upcoming events",
        needsInput: true,
        total: true,
        inputs: [
          expect.objectContaining({
            key: "city",
            type: "choice",
            needsInput: true,
          }),
          expect.objectContaining({ key: "within", min: 1, max: 9 }),
        ],
        readsHidden: [],
      });
      expect(JSON.stringify(listed.body)).not.toContain("run");
      const manifest = await call("GET", cookie, ["manifest"]);
      expect(manifest.status).toBe(200);
      const queries = (manifest.body as unknown as CompositionManifest)
        .namedQueries;
      expect(queries[0]).toMatchObject({
        name: "events.upcoming",
        params: {
          type: "object",
          required: ["city"],
          properties: { city: { enum: ["lahore", "karachi"] } },
        },
      });
    });

    it("never draws a field the public may not read, a draft, or a trusted read", async () => {
      const t = await boot();
      const drawn = await published(t, [
        list("schema", {
          namedQuery: { name: "events.upcoming", params: { city: "lahore" } },
        }),
        list("entries", { namedQuery: { name: "events.all" } }),
        list("trusted", { namedQuery: { name: "events.trusted" } }),
      ]);
      expect(drawn.html).toContain("Alpha");
      expect(drawn.html).toContain("Beta");
      expect(drawn.html).toContain("Gamma");
      expect(drawn.html).not.toContain(SENTINEL);
      expect(drawn.html).not.toContain("Draft");
      expect(drawn.failures).toEqual([
        expect.objectContaining({
          code: "trusted-read",
          query: "events.trusted",
          nodeId: "trusted",
        }),
      ]);
    });
  }
);
