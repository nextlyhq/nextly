/**
 * Named queries' declarations: the boot's checks, the process registry, and
 * the one judgement of a list's stored inputs the save and the run share.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createNamedQueryRegistry,
  defineNamedQuery,
  judgeNamedParams,
  namedQueryDeclaration,
  namedQueryNeedsInput,
  namedQueryProblem,
  namedQueryTimeout,
  param,
  type NamedQueryDefinition,
} from "./named-query";

const run = () => Promise.resolve({ rows: [] });

const events = defineNamedQuery({
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
    keyword: param.text({ label: "Keyword", maxLength: 10 }),
    from: param.day({ label: "From", default: "today" }),
    within: param.number({
      label: "Within",
      integer: true,
      min: 1,
      max: 365,
      default: 30,
    }),
    freeOnly: param.boolean({ label: "Free only" }),
    venue: param.entry({ label: "Venue", collection: "venues" }),
  },
  reads: { collections: ["events", "venues"] },
  rows: {
    key: "id",
    fields: [
      { name: "id", type: "text" },
      { name: "title", type: "text" },
    ],
  },
  run,
});

/** A definition with one part replaced, to judge that part alone. */
function withPart(part: Record<string, unknown>): unknown {
  return { ...events, ...part };
}

describe("a named query's declaration", () => {
  it("types run's inputs by their declarations", () => {
    defineNamedQuery({
      name: "typed",
      label: "Typed",
      params: events.params,
      reads: { collections: ["venues"] },
      rows: { collection: "venues" },
      run: args => {
        // Required, defaulted and yes-or-no inputs are always present.
        expectTypeOf(args.params.city).toEqualTypeOf<"lahore" | "karachi">();
        expectTypeOf(args.params.within).toEqualTypeOf<number>();
        expectTypeOf(args.params.freeOnly).toEqualTypeOf<boolean>();
        // An optional one with no default may be absent.
        expectTypeOf(args.params.keyword).toEqualTypeOf<string | undefined>();
        expectTypeOf(args.params.venue).toEqualTypeOf<
          string | number | undefined
        >();
        return run();
      },
    });
  });

  it("accepts a well-formed definition", () => {
    expect(namedQueryProblem(events).problem).toBeUndefined();
    // As many reads as a cached result can carry, and a choice value as
    // long as a list can store: the bounds themselves.
    expect(
      namedQueryProblem({
        ...events,
        params: {
          c: param.choice({
            label: "C",
            options: [{ value: "x".repeat(200), label: "Long" }],
          }),
        },
        reads: {
          collections: Array.from({ length: 63 }, (_, i) => `c${String(i)}`),
          site: true,
        },
        rows: { collection: "c0" },
      }).problem
    ).toBeUndefined();
  });

  it.each([
    ["a name that is not lowercase dotted words", { name: "Events" }, "name"],
    ["a name over 64 characters", { name: "a".repeat(65) }, "name"],
    ["no label", { label: "" }, "no label"],
    ["a label over 60 characters", { label: "x".repeat(61) }, "label"],
    ["no run function", { run: undefined }, "run function"],
    ["a timeout over 30 seconds", { timeoutMs: 30_001 }, "timeoutMs"],
    [
      "rows of a collection it does not read",
      { rows: { collection: "posts" } },
      'entries of "posts"',
    ],
    [
      "a row field a binding could not address",
      {
        rows: {
          key: "id",
          fields: [
            { name: "id", type: "text" },
            { name: "display-name", type: "text" },
          ],
        },
      },
      'named "display-name"',
    ],
    [
      "a row field a plain object would not keep",
      {
        rows: {
          key: "id",
          fields: [
            { name: "id", type: "text" },
            { name: "__proto__", type: "text" },
          ],
        },
      },
      'named "__proto__"',
    ],
    [
      "a group's own field a binding could not address",
      {
        rows: {
          key: "id",
          fields: [
            { name: "id", type: "text" },
            {
              name: "venue",
              type: "group",
              fields: [{ name: "street name", type: "text" }],
            },
          ],
        },
      },
      'named "street name"',
    ],
    [
      "two row fields of one name",
      {
        rows: {
          key: "id",
          fields: [
            { name: "id", type: "text" },
            { name: "title", type: "text" },
            { name: "title", type: "number" },
          ],
        },
      },
      'two fields named "title"',
    ],
    [
      "two fields of one name in a group",
      {
        rows: {
          key: "id",
          fields: [
            { name: "id", type: "text" },
            {
              name: "venue",
              type: "group",
              fields: [
                { name: "city", type: "text" },
                { name: "city", type: "text" },
              ],
            },
          ],
        },
      },
      'two fields named "city"',
    ],
    [
      "a row key that is not a declared field",
      { rows: { key: "slug", fields: [{ name: "id", type: "text" }] } },
      'key "slug"',
    ],
    [
      "a row key that is not text or a number",
      { rows: { key: "at", fields: [{ name: "at", type: "date" }] } },
      "not a text or number field",
    ],
    [
      "an entry input of a collection it does not read",
      {
        params: { author: param.entry({ label: "Author", collection: "x" }) },
      },
      'entry of "x"',
    ],
    [
      "a default that does not fit its input",
      {
        params: {
          n: param.number({ label: "N", min: 1, max: 5, default: 9 }),
        },
      },
      "default does not fit",
    ],
    [
      "more reads than a cached result can carry tags for",
      {
        reads: {
          collections: Array.from({ length: 64 }, (_, i) => `c${String(i)}`),
          site: true,
        },
        rows: { collection: "c0" },
        params: {},
      },
      "65 reads; at most 64",
    ],
    [
      "a bound read from an unset variable",
      { params: { n: param.number({ label: "N", min: Number("") / 0 }) } },
      "not a finite number",
    ],
    [
      "an infinite bound",
      { params: { n: param.number({ label: "N", max: Infinity }) } },
      "not a finite number",
    ],
    [
      "a whole-number input's bound that is not a safe whole number",
      { params: { n: param.number({ label: "N", integer: true, min: 1.5 }) } },
      "not a safe whole number",
    ],
    [
      "an input key longer than a list's action takes",
      { params: { ["k".repeat(65)]: param.text({ label: "K" }) } },
      "at most 64 characters",
    ],
    [
      "more choices than an editor lists",
      {
        params: {
          c: param.choice({
            label: "C",
            options: Array.from({ length: 201 }, (_, i) => ({
              value: `v${String(i)}`,
              label: `V${String(i)}`,
            })),
          }),
        },
      },
      "201 options",
    ],
    [
      "row groups that hold themselves",
      {
        rows: (() => {
          const group: { name: string; type: string; fields: unknown[] } = {
            name: "loop",
            type: "group",
            fields: [],
          };
          group.fields.push(group);
          return { key: "id", fields: [{ name: "id", type: "text" }, group] };
        })(),
      },
      "more than 8 groups deep",
    ],
    [
      "a choice value no list could store",
      {
        params: {
          c: param.choice({
            label: "C",
            options: [{ value: "x".repeat(201), label: "Long" }],
          }),
        },
      },
      "longer than 200 characters",
    ],
    [
      "a choice with no options",
      { params: { c: { type: "choice", label: "C", options: [] } } },
      "no options",
    ],
    [
      "an input of an unknown type",
      { params: { c: { type: "time", label: "C" } } },
      'type "time"',
    ],
    [
      "more than 12 inputs",
      {
        params: Object.fromEntries(
          Array.from({ length: 13 }, (_, index) => [
            `p${String(index)}`,
            param.text({ label: "P" }),
          ])
        ),
      },
      "13 inputs",
    ],
  ])("refuses %s", (_case, part, named) => {
    expect(namedQueryProblem(withPart(part)).problem).toContain(named);
  });

  it("names the reads the site does not know, without refusing them", () => {
    const judged = namedQueryProblem(events, {
      collection: slug => slug === "events",
      single: () => false,
    });
    expect(judged.problem).toBeUndefined();
    expect(judged.unknownReads).toEqual(["venues"]);
  });

  it("keeps run out of the declaration", () => {
    expect("run" in namedQueryDeclaration(events)).toBe(false);
  });

  it("bounds the time a run may take", () => {
    expect(namedQueryTimeout(events)).toBe(5000);
    expect(namedQueryTimeout({ ...events, timeoutMs: 1200 })).toBe(1200);
  });

  it("says when a query needs an input an author must give", () => {
    expect(namedQueryNeedsInput(events)).toBe(true);
    expect(namedQueryNeedsInput({ ...events, params: {} })).toBe(false);
  });
});

describe("a named query registry", () => {
  it("registers all or nothing, naming the definition refused", () => {
    const registry = createNamedQueryRegistry();
    expect(() =>
      registry.register([events, withPart({ name: "Bad" }) as never], {
        source: "@acme/events",
      })
    ).toThrow(/named query "Bad" from "@acme\/events"/);
    expect(registry.all()).toEqual([]);
  });

  it("names both sources when two register one name", () => {
    const registry = createNamedQueryRegistry();
    registry.register([events], { source: "@acme/events" });
    expect(() =>
      registry.register([events], { source: "@acme/other" })
    ).toThrow(/registered by "@acme\/events".*again by "@acme\/other"/);
    expect(() =>
      registry.register([
        { ...events, name: "twice" },
        { ...events, name: "twice" },
      ])
    ).toThrow(/registered twice/);
  });

  it("answers a registered query, and its declaration without run", () => {
    const registry = createNamedQueryRegistry();
    registry.register([events]);
    expect(registry.definitionOf("events.upcoming")).toBe(events);
    const declaration = registry.declarationOf("events.upcoming");
    expect(declaration?.label).toBe("Upcoming events");
    expect(declaration !== undefined && "run" in declaration).toBe(false);
  });

  it("keeps each registry's queries its own", () => {
    const tenantA = createNamedQueryRegistry();
    const tenantB = createNamedQueryRegistry();
    tenantA.register([events]);
    tenantB.register([{ ...events, label: "B's events" }]);
    expect(tenantA.declarationOf("events.upcoming")?.label).toBe(
      "Upcoming events"
    );
    expect(tenantB.declarationOf("events.upcoming")?.label).toBe("B's events");
    expect(createNamedQueryRegistry().definitionOf("events.upcoming")).toBe(
      undefined
    );
  });

  it("holds a definition of typed inputs as one of any inputs", () => {
    const held: NamedQueryDefinition = events;
    expect(held.name).toBe("events.upcoming");
  });
});

describe("a list's stored inputs, judged", () => {
  it("fills defaults, leaves out an optional empty input and an undeclared one", () => {
    const judged = judgeNamedParams(
      events,
      { city: "lahore", old: 1 },
      { today: "2026-11-06" }
    );
    expect(judged.problems).toEqual([]);
    expect(judged.unknown).toEqual(["old"]);
    expect(judged.values).toEqual({
      city: "lahore",
      from: "2026-11-06",
      within: 30,
      freeOnly: false,
    });
  });

  it("names a required input left out, in the editor's words", () => {
    expect(judgeNamedParams(events, {}).problems).toEqual([
      {
        param: "city",
        kind: "missing",
        message: "Choose a city. Upcoming events needs one to run.",
      },
    ]);
    expect(
      judgeNamedParams(events, {}, { atRun: true }).problems[0]?.message
    ).toBe("Upcoming events needs a city, which this list doesn't set.");
  });

  it.each([
    ["city", "paris", "Choose one of Upcoming events's city options."],
    ["keyword", "x".repeat(11), "Enter at most 10 characters."],
    ["within", 2.5, "Enter a whole number from 1 to 365."],
    ["within", 0, "Enter a whole number from 1 to 365."],
    ["from", "2026-02-30", "Enter a day written YYYY-MM-DD."],
    ["freeOnly", "yes", "Choose yes or no."],
    ["venue", true, "Choose an entry by its id."],
  ])("refuses %s = %j", (key, value, message) => {
    const judged = judgeNamedParams(events, { city: "lahore", [key]: value });
    expect(judged.problems).toEqual([{ param: key, kind: "invalid", message }]);
    expect(key in judged.values).toBe(false);
  });
});
