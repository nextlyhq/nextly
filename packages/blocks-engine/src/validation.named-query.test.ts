/**
 * A collection list whose source is a named query, judged at save: its shape
 * always, its name and inputs against the query's declaration when the
 * caller can answer for the site's queries, and what visitors can read of it
 * when the schema is known too.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import {
  COLLECTION_LIST_TYPE,
  LIST_FIELD_CODES,
  listQueryIssues,
  namesListSource,
  readListQuery,
  type ListFields,
  type ListFieldSource,
} from "./list-query";
import {
  defineNamedQuery,
  namedQueryDeclaration,
  param,
  type NamedQuerySource,
} from "./named-query";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";
import { ISSUE_CODES, validate, type ValidationContext } from "./validation";

const events = defineNamedQuery({
  name: "events.upcoming",
  label: "Upcoming events",
  params: {
    city: param.choice({
      label: "City",
      required: true,
      options: [{ value: "lahore", label: "Lahore" }],
    }),
    within: param.number({ label: "Within", integer: true, min: 1, max: 9 }),
  },
  reads: { collections: ["events", "notes"] },
  rows: { collection: "events" },
  run: () => Promise.resolve({ rows: [] }),
});

const queries: NamedQuerySource = {
  declarationOf: name =>
    name === events.name ? namedQueryDeclaration(events) : undefined,
};

/** Public fields, or none for a collection visitors cannot read. */
function fieldsOf(label: string, readable: boolean): ListFields {
  return {
    label,
    declared: new Set(["id", "title"]),
    readable: readable ? [{ name: "id", type: "text" }] : [],
  };
}

const fields = (eventsReadable: boolean): ListFieldSource => ({
  fieldsOf: collection =>
    collection === "events"
      ? fieldsOf("Events", eventsReadable)
      : collection === "notes"
        ? fieldsOf("Notes", false)
        : undefined,
});

function list(
  id: string,
  props: Record<string, unknown>,
  children: unknown[] = []
): Record<string, unknown> {
  return {
    id,
    type: COLLECTION_LIST_TYPE,
    version: 1,
    props,
    slots: { children },
  };
}

function page(...nodes: unknown[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

const named = (params?: Record<string, unknown>, name = events.name) => ({
  namedQuery: { name, ...(params === undefined ? {} : { params }) },
});

const ctx: ValidationContext = {
  breakpoints: FIXTURE_BREAKPOINTS,
  mode: "forgiving",
  namedQueries: queries,
};

/** The list issues of a document, as code, severity and path. */
function judged(
  document: BlockDocument,
  extra: Partial<ValidationContext> = {}
): [string, string, string][] {
  return validate(document, { ...ctx, ...extra })
    .filter(issue => issue.code.startsWith("list-"))
    .map(issue => [issue.code, issue.severity, issue.path]);
}

describe("readListQuery with a custom source", () => {
  it("reads a custom source and its inputs", () => {
    expect(
      readListQuery({ ...named({ city: "lahore", within: 3 }), limit: 4 })
    ).toEqual({
      query: {
        namedQuery: {
          name: events.name,
          params: { city: "lahore", within: 3 },
        },
        filters: [],
        sort: [],
        limit: 4,
      },
      problems: [],
    });
  });

  it.each([
    ["a value that is not { name, params }", "events", "not { name, params }"],
    [
      "a name that is not a query name",
      { name: "Events!" },
      'names "Events!", which is not a query name',
    ],
    [
      "inputs that are not a record",
      { name: "a", params: [1] },
      "not a record of values",
    ],
    [
      "an input holding a list",
      { name: "a", params: { city: ["x"] } },
      'Input "city" holds',
    ],
    [
      "an input of more than 200 characters",
      { name: "a", params: { q: "x".repeat(201) } },
      "more than 200 characters",
    ],
    [
      "more than 12 inputs",
      {
        name: "a",
        params: Object.fromEntries(
          Array.from({ length: 13 }, (_, i) => [`p${String(i)}`, 1])
        ),
      },
      "at most 12 inputs",
    ],
  ])("refuses %s", (_case, value, message) => {
    const read = readListQuery({ namedQuery: value });
    expect(read.query.namedQuery).toBeUndefined();
    expect(read.problems).toEqual([
      expect.objectContaining({
        prop: "namedQuery",
        code: "list-named-query-invalid",
        message: expect.stringContaining(message) as unknown,
      }),
    ]);
  });

  it.each([
    ["a collection", { collection: "events" }],
    ["related entries", { relation: { of: "entry", field: "tags" } }],
    ["filters", { filters: [{ field: "a", op: "exists", value: true }] }],
    ["a sort", { sort: "-title" }],
  ])("refuses a custom source beside %s", (_case, other) => {
    expect(readListQuery({ ...named(), ...other }).problems).toContainEqual(
      expect.objectContaining({
        prop: "namedQuery",
        code: "list-source-conflict",
      })
    );
  });

  it("takes empty filters and an empty sort beside it as naming nothing", () => {
    expect(
      readListQuery({ ...named(), filters: [], sort: " ", collection: "" })
        .problems
    ).toEqual([]);
  });
});

describe("namesListSource", () => {
  it("names a collection, related entries, filters or a sort, and nothing empty", () => {
    expect(namesListSource({ collection: "events" })).toBe(true);
    expect(namesListSource({ relation: { of: "entry", field: "x" } })).toBe(
      true
    );
    expect(
      namesListSource({ filters: [{ field: "a", op: "exists", value: true }] })
    ).toBe(true);
    expect(namesListSource({ sort: "-title" })).toBe(true);
    // The empty forms an editor or a client writes name no source.
    expect(
      namesListSource({
        collection: " ",
        filters: [],
        sort: "",
        relation: null,
      })
    ).toBe(false);
  });
});

describe("a custom source at save", () => {
  it("judges a custom source by its shape alone without the site's queries", () => {
    const document = page(list("l", named({ within: 99 }, "gone.query")));
    expect(judged(document, { namedQueries: undefined })).toEqual([]);
    expect(
      judged(page(list("l", { ...named(), collection: "events" })), {
        namedQueries: undefined,
      })
    ).toEqual([["list-source-conflict", "error", "/nodes/0/props/namedQuery"]]);
  });

  it("refuses a query this site does not register, and keeps one a stored page holds", () => {
    const document = page(list("l", named({}, "gone.query")));
    expect(judged(document)).toEqual([
      ["list-named-query-unknown", "error", "/nodes/0/props/namedQuery"],
    ]);
    expect(judged(document, { stored: [document] })).toEqual([
      ["list-named-query-unknown", "warning", "/nodes/0/props/namedQuery"],
    ]);
  });

  it("refuses a missing required input and a value an input does not take, at the input", () => {
    expect(judged(page(list("l", named({ within: 10 }))))).toEqual([
      [
        "list-named-query-param-missing",
        "error",
        "/nodes/0/props/namedQuery/params/city",
      ],
      [
        "list-named-query-param-invalid",
        "error",
        "/nodes/0/props/namedQuery/params/within",
      ],
    ]);
  });

  it("names the input in the editor's words", () => {
    const [missing] = validate(page(list("l", named({}))), ctx).filter(
      issue => issue.code === "list-named-query-param-missing"
    );
    expect(missing?.message).toBe(
      "Choose a city. Upcoming events needs one to run."
    );
  });

  it("always warns about an input the query no longer takes", () => {
    expect(judged(page(list("l", named({ city: "lahore", gone: 1 }))))).toEqual(
      [
        [
          "list-named-query-param-unknown",
          "warning",
          "/nodes/0/props/namedQuery/params/gone",
        ],
      ]
    );
  });

  it("refuses rows visitors can never read, and warns about a read they can't", () => {
    const document = page(list("l", named({ city: "lahore" })));
    expect(judged(document, { listFields: fields(false) })).toEqual([
      ["list-named-query-rows-hidden", "error", "/nodes/0/props/namedQuery"],
      ["list-named-query-reads-hidden", "warning", "/nodes/0/props/namedQuery"],
    ]);
    expect(judged(document, { listFields: fields(true) })).toEqual([
      ["list-named-query-reads-hidden", "warning", "/nodes/0/props/namedQuery"],
    ]);
    const [hidden] = validate(document, {
      ...ctx,
      listFields: fields(true),
    }).filter(issue => issue.code === "list-named-query-reads-hidden");
    expect(hidden?.message).toBe(
      "It reads Notes, which visitors can't read, so a published list of it may show nothing."
    );
  });

  it("accepts a custom source whose inputs fit", () => {
    expect(
      judged(page(list("l", named({ city: "lahore", within: 3 }))), {
        listFields: fields(true),
      }).filter(([, severity]) => severity === "error")
    ).toEqual([]);
  });

  it("refuses a custom source's list split into pages, and keeps one a stored page holds", () => {
    const document = page(
      list("l", { ...named({ city: "lahore" }), paginate: true })
    );
    expect(judged(document)).toEqual([
      ["list-paginate-named", "error", "/nodes/0/props/paginate"],
    ]);
    // Judged by its shape alone too, as the editor's save is.
    expect(judged(document, { namedQueries: undefined })).toEqual([
      ["list-paginate-named", "error", "/nodes/0/props/paginate"],
    ]);
    expect(judged(document, { stored: [document] })).toEqual([
      ["list-paginate-named", "warning", "/nodes/0/props/paginate"],
    ]);
    const [refused] = validate(document, ctx).filter(
      issue => issue.code === "list-paginate-named"
    );
    expect(refused?.message).toBe(
      "A custom source's list can't be split into pages yet. Turn off Split into pages, or choose a collection."
    );
    // Not split into pages, the same list saves.
    expect(
      judged(page(list("l", { ...named({ city: "lahore" }), paginate: false })))
    ).toEqual([]);
  });

  it("refuses a related list inside a custom source's list", () => {
    const inner = list("inner", {
      collection: "events",
      relation: { of: "item", field: "tags" },
    });
    expect(
      listQueryIssues([list("outer", named({ city: "lahore" }), [inner])], {
        namedQueries: queries,
      })
    ).toEqual([
      expect.objectContaining({
        nodeId: "inner",
        code: "list-relation-invalid",
        message: expect.stringContaining(
          "shows a custom source's rows"
        ) as unknown,
      }),
    ]);
  });

  it("names every new code in the vocabulary, and the host-decided ones as such", () => {
    for (const code of [
      "list-named-query-invalid",
      "list-source-conflict",
      "list-named-query-unknown",
      "list-named-query-param-missing",
      "list-named-query-param-invalid",
      "list-named-query-param-unknown",
      "list-named-query-reads-hidden",
      "list-named-query-rows-hidden",
    ]) {
      expect(ISSUE_CODES).toHaveProperty(code);
    }
    expect(LIST_FIELD_CODES.has("list-named-query-unknown")).toBe(true);
    expect(LIST_FIELD_CODES.has("list-source-conflict")).toBe(false);
  });
});
