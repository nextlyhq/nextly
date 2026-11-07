/**
 * Named queries at the page builder's boot: the site's and each plugin's
 * registered into an emptied registry, all or nothing, a name taken twice
 * naming both sources, a declared read the code does not configure logged;
 * and each declaration as the editor's route and the manifest read it,
 * without its run function.
 */
import {
  defineNamedQuery,
  judgeNamedParams,
  param,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  namedQueryItem,
  namedQueryParamsSchema,
  readNamedQueries,
  registerNamedQueriesAtBoot,
} from "./named-queries";
import { namedQueriesOf, pageBuilder } from "./plugin";

const run = () => Promise.resolve({ rows: [] });

const upcoming = defineNamedQuery({
  name: "events.upcoming",
  label: "Upcoming events",
  params: {
    city: param.choice({
      label: "City",
      required: true,
      options: [{ value: "lahore", label: "Lahore" }],
    }),
    within: param.number({
      label: "Within",
      integer: true,
      min: 1,
      max: 9,
      default: 3,
    }),
    keyword: param.text({ label: "Keyword" }),
  },
  reads: { collections: ["events"] },
  rows: { key: "id", fields: [{ name: "id", type: "text" }] },
  total: true,
  run,
});

const fromPlugin = defineNamedQuery({
  name: "venues.all",
  label: "All venues",
  reads: { collections: ["venues"], singles: ["venue-settings"] },
  rows: { collection: "venues" },
  run,
});

/** A boot context: the code's collections and Singles, and the plugins. */
function bootContext(plugins: unknown[]) {
  const warn = vi.fn();
  return {
    warn,
    ctx: {
      config: {
        collections: [{ slug: "events" }, { slug: "venues" }],
        singles: [],
        plugins,
      },
      logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never,
  };
}

/** A plugin summary declaring `value` for the page builder. */
function declaring(name: string, value: unknown) {
  return {
    name,
    version: "1.0.0",
    enabled: true,
    contributes: {
      declarations: { "@nextlyhq/plugin-page-builder": value },
    },
  };
}

describe("named queries at boot", () => {
  it("registers the site's and each plugin's into a registry of the boot's own", () => {
    const { ctx } = bootContext([
      declaring("@acme/venues", { namedQueries: [fromPlugin] }),
    ]);
    const registry = registerNamedQueriesAtBoot(ctx, [upcoming]);
    expect(registry.all().map(query => query.name)).toEqual([
      "events.upcoming",
      "venues.all",
    ]);
  });

  it("keeps two sites' queries apart in one process", () => {
    const siteA = registerNamedQueriesAtBoot(bootContext([]).ctx, [upcoming]);
    const siteB = registerNamedQueriesAtBoot(bootContext([]).ctx, [
      { ...upcoming, label: "Site B's events" },
      fromPlugin,
    ]);
    // Booting the second site leaves the first's as it was.
    expect(siteA.declarationOf("events.upcoming")?.label).toBe(
      "Upcoming events"
    );
    expect(siteA.definitionOf("venues.all")).toBeUndefined();
    expect(siteB.declarationOf("events.upcoming")?.label).toBe(
      "Site B's events"
    );
  });

  it("hands each page builder's own queries to the route that renders its site", () => {
    const siteA = pageBuilder({ namedQueries: [upcoming] });
    const siteB = pageBuilder({
      namedQueries: [{ ...upcoming, label: "Site B's events" }, fromPlugin],
    });
    expect(namedQueriesOf(siteA).definitionOf("events.upcoming")).toBe(
      upcoming
    );
    expect(namedQueriesOf(siteA).definitionOf("venues.all")).toBeUndefined();
    expect(namedQueriesOf(siteB).definitionOf("events.upcoming")?.label).toBe(
      "Site B's events"
    );
    // A plugin that is no page builder hands out none.
    expect(
      namedQueriesOf({ name: "@acme/other" } as never).definitionOf(
        "events.upcoming"
      )
    ).toBeUndefined();
  });

  it("names both sources when a plugin takes the site's name", () => {
    const { ctx } = bootContext([
      declaring("@acme/events", {
        namedQueries: [{ ...fromPlugin, name: "events.upcoming" }],
      }),
    ]);
    expect(() => registerNamedQueriesAtBoot(ctx, [upcoming])).toThrow(
      /"events\.upcoming" is already registered by "pageBuilder\(\{ namedQueries \}\)" and cannot be registered again by "@acme\/events"/
    );
  });

  it("refuses a declaration whose namedQueries is not a list, naming the plugin", () => {
    const { ctx } = bootContext([
      declaring("@acme/broken", { namedQueries: upcoming }),
    ]);
    expect(() => registerNamedQueriesAtBoot(ctx, [])).toThrow(
      /"@acme\/broken" declared namedQueries .* as object/
    );
  });

  it("logs, without refusing, a read the code's configuration does not name", () => {
    const { ctx, warn } = bootContext([
      declaring("@acme/venues", { namedQueries: [fromPlugin] }),
    ]);
    registerNamedQueriesAtBoot(ctx, [upcoming]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      '"venues.all" reads "venue-settings"'
    );
  });
});

describe("a named query's declaration, as the editor and the API read it", () => {
  it("lists each input with what its control needs, and never the run function", () => {
    const hidden = { collection: "events", label: "Events", fields: ["title"] };
    const item = namedQueryItem(upcoming, [hidden]);
    expect(item).toMatchObject({
      name: "events.upcoming",
      needsInput: true,
      total: true,
      readsHidden: [hidden],
      rows: { key: "id", fields: [{ name: "id", type: "text", kind: "text" }] },
    });
    expect(item.inputs).toEqual([
      {
        key: "city",
        type: "choice",
        label: "City",
        needsInput: true,
        required: true,
        options: [{ value: "lahore", label: "Lahore" }],
      },
      {
        key: "within",
        type: "number",
        label: "Within",
        needsInput: false,
        required: false,
        default: 3,
        min: 1,
        max: 9,
        integer: true,
      },
      {
        key: "keyword",
        type: "text",
        label: "Keyword",
        needsInput: false,
        required: false,
        maxLength: 200,
      },
    ]);
    expect(JSON.stringify(item)).not.toContain("run");
    // The declaration the editor judges inputs against is the declaration,
    // run-free: a judgement over it refuses what the registry's would.
    expect(item.declaration.params).toEqual(upcoming.params);
    expect(judgeNamedParams(item.declaration, {}).problems).toEqual(
      judgeNamedParams(upcoming, {}).problems
    );
  });

  it("lists a group's own row fields, however deep, for a binding to name", () => {
    const withSeo = defineNamedQuery({
      name: "pages.seo",
      label: "Pages with SEO",
      reads: { collections: ["pages"] },
      rows: {
        key: "id",
        fields: [
          { name: "id", type: "text" },
          {
            name: "seo",
            type: "group",
            fields: [
              { name: "title", type: "text" },
              {
                name: "image",
                type: "group",
                fields: [{ name: "alt", type: "text" }],
              },
            ],
          },
        ],
      },
      run,
    });
    const rows = namedQueryItem(withSeo).rows;
    expect("fields" in rows ? rows.fields[1] : undefined).toEqual({
      name: "seo",
      type: "group",
      fields: [
        { name: "title", type: "text", kind: "text" },
        {
          name: "image",
          type: "group",
          fields: [{ name: "alt", type: "text", kind: "text" }],
        },
      ],
    });
  });

  it("lists no children of a row field holding several, which no binding may follow", () => {
    const withItems = defineNamedQuery({
      name: "orders.lines",
      label: "Orders with lines",
      reads: { collections: ["orders"] },
      rows: {
        key: "id",
        fields: [
          { name: "id", type: "text" },
          {
            name: "lines",
            type: "group",
            hasMany: true,
            fields: [{ name: "title", type: "text" }],
          },
          {
            name: "billing",
            type: "group",
            fields: [{ name: "city", type: "text" }],
          },
        ],
      },
      run,
    });
    const rows = namedQueryItem(withItems).rows;
    const fields = "fields" in rows ? rows.fields : [];
    // `lines.title` is a path the binding walk refuses, so it isn't offered.
    expect(fields[1]).toEqual({ name: "lines", type: "group" });
    // The control: a group holding one keeps its children.
    expect(fields[2]).toEqual({
      name: "billing",
      type: "group",
      fields: [{ name: "city", type: "text", kind: "text" }],
    });
  });

  it("gives a client its inputs as JSON Schema, naming only the inputs that need a value", () => {
    expect(namedQueryParamsSchema(upcoming)).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        city: { title: "City", enum: ["lahore"] },
        within: { title: "Within", type: "integer", minimum: 1, maximum: 9 },
        keyword: { title: "Keyword", type: "string", maxLength: 200 },
      },
      required: ["city"],
    });
  });

  it("bounds an entry input's id in its schema as the save does", () => {
    const schema = namedQueryParamsSchema({
      ...fromPlugin,
      params: { venue: param.entry({ label: "Venue", collection: "venues" }) },
    }) as { properties: { venue: { anyOf: Record<string, unknown>[] } } };
    expect(schema.properties.venue.anyOf).toEqual([
      { type: "string", minLength: 1, maxLength: 200 },
      {
        type: "integer",
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    ]);
    // The save takes exactly what the schema bounds, at both edges.
    const judged = (venue: unknown) =>
      judgeNamedParams(
        {
          ...fromPlugin,
          params: {
            venue: param.entry({ label: "Venue", collection: "venues" }),
          },
        },
        { venue }
      ).problems.length;
    expect(judged("x".repeat(200))).toBe(0);
    expect(judged("x".repeat(201))).toBe(1);
    expect(judged("")).toBe(1);
    expect(judged(Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(judged(Number.MAX_SAFE_INTEGER + 2)).toBe(1);
  });

  it("bounds a whole-number input to the safe range, within its own bounds", () => {
    const schemaOf = (within: ReturnType<typeof param.number>) =>
      (
        namedQueryParamsSchema({ ...fromPlugin, params: { within } }) as {
          properties: { within: Record<string, unknown> };
        }
      ).properties.within;
    expect(schemaOf(param.number({ label: "N", integer: true }))).toEqual({
      title: "N",
      type: "integer",
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(
      schemaOf(param.number({ label: "N", integer: true, min: 1, max: 9 }))
    ).toMatchObject({ minimum: 1, maximum: 9 });
    // The save refuses just past the bound the schema states.
    const judged = (value: number) =>
      judgeNamedParams(
        {
          ...fromPlugin,
          params: { n: param.number({ label: "N", integer: true }) },
        },
        { n: value }
      ).problems.length;
    expect(judged(Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(judged(Number.MAX_SAFE_INTEGER + 1)).toBe(1);
  });

  it("names a declared collection visitors can read nothing of, with its fields, judging each once", async () => {
    // `events` is the rows' collection of none of these but the plugin's
    // `venues`; visitors read nothing of `events`, and all of `venues`.
    const listFields = vi.fn((slug: string) =>
      Promise.resolve(
        slug === "events"
          ? {
              label: "Events",
              declared: new Set(["id", "createdAt", "title", "price"]),
              readable: [],
            }
          : {
              label: "Venues",
              declared: new Set(["id", "name"]),
              readable: [{ name: "name", type: "text" }],
            }
      )
    );
    const answer = await readNamedQueries({
      queries: () => [
        upcoming,
        fromPlugin,
        { ...upcoming, name: "events.again" },
      ],
      listFields,
    });
    const events = {
      collection: "events",
      label: "Events",
      fields: ["title", "price"],
    };
    expect(answer.items.map(item => item.readsHidden)).toEqual([
      [events],
      [],
      [events],
    ]);
    expect(listFields).toHaveBeenCalledTimes(2);
    expect(answer.meta.total).toBe(3);
  });

  it("warns of a collection whose fields could not be read, rather than saying all is well", async () => {
    const answer = await readNamedQueries({
      queries: () => [upcoming],
      listFields: () => Promise.reject(new Error("no record")),
    });
    // Nothing is known of its fields, so none is named.
    expect(answer.items[0]?.readsHidden).toEqual([
      { collection: "events", label: "events", fields: [] },
    ]);
  });

  it("does not call a collection hidden whose own fields visitors cannot read, but whose entries they can", async () => {
    const answer = await readNamedQueries({
      queries: () => [upcoming],
      listFields: () =>
        Promise.resolve({
          declared: new Set(["id", "createdAt", "secret"]),
          // The id and timestamps a visitor still reads.
          readable: [{ name: "id", type: "text" }],
        }),
    });
    expect(answer.items[0]?.readsHidden).toEqual([]);
  });
});
