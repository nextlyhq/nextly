/**
 * A document's bindings judged against the schema at save: refused where they
 * break the rules, and kept as a warning where the stored page already held
 * the same break, so a schema change never makes a page unsavable.
 */
import { describe, expect, it } from "vitest";

import type { BindingFieldShape, BindingSchemaSource } from "./binding-rules";
import { bindingSchemaIssues } from "./binding-schema-issues";

/** The posts' declared fields: `title` and nothing called `headline`. */
const POSTS: readonly BindingFieldShape[] = [{ name: "title", type: "text" }];

const schema: BindingSchemaSource = {
  fieldsOf: ref =>
    "collection" in ref && ref.collection === "posts" ? POSTS : undefined,
};

const heading = (id: string, path: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: "Own text", level: "h2" },
  bindings: { text: { $bind: path } },
});

const judged = (
  nodes: readonly unknown[],
  stored?: readonly unknown[],
  settings?: unknown,
  source: BindingSchemaSource = schema
) =>
  bindingSchemaIssues(
    { nodes, ...(settings === undefined ? {} : { settings }) },
    {
      schema: source,
      entry: { collection: "posts" },
      ...(stored === undefined ? {} : { stored }),
    }
  );

/** A Single's binding of `path`, on a heading. */
const fromSingle = (id: string, path: string, single: string) => ({
  ...heading(id, path),
  bindings: { text: { $bind: path, source: "single", sourceKey: single } },
});

/** A document's metadata whose title binds `path`. */
const titled = (path: string) => ({
  seo: { title: ["Read ", { $bind: path, fallback: "this" }] },
});

describe("bindings judged against the schema at save", () => {
  it("refuses a binding to a field the source does not have", () => {
    const issues = judged([heading("h", "headline"), heading("t", "title")]);
    // The binding to `title`, which the source has, is the control.
    expect(issues).toEqual([
      expect.objectContaining({
        path: "/nodes/0/bindings/text",
        nodeId: "h",
        code: "binding-field-missing",
        severity: "error",
      }),
    ]);
  });

  it("finds a binding nested in a container's slot, at its own path", () => {
    const section = {
      id: "s",
      type: "core/section",
      version: 1,
      props: {},
      slots: { children: [heading("h", "headline")] },
    };
    expect(judged([section]).map(issue => issue.path)).toEqual([
      "/nodes/0/slots/children/0/bindings/text",
    ]);
  });

  it("keeps a break the stored page already held as a warning", () => {
    // `headline` was renamed in the schema after this page was saved: the
    // page saves again, keeping the binding, which renders its fallback.
    const page = [heading("h", "headline")];
    const issues = judged(page, [{ nodes: page }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
  });

  it("refuses a new break beside a held one", () => {
    const stored = [{ nodes: [heading("h", "headline")] }];
    const issues = judged(
      [heading("h", "headline"), heading("n", "subtitle")],
      stored
    );
    expect(issues.map(issue => [issue.nodeId, issue.severity])).toEqual([
      ["h", "warning"],
      ["n", "error"],
    ]);
  });

  it("refuses a held block's binding changed to another missing field", () => {
    // Same block, same prop, but a different path: a new problem.
    const issues = judged(
      [heading("h", "subtitle")],
      [{ nodes: [heading("h", "headline")] }]
    );
    expect(issues[0]?.severity).toBe("error");
  });

  it("refuses a held block's binding moved to another source missing the same field", () => {
    // Same block, prop and path, but now read from a Single: a new binding.
    const issues = judged(
      [fromSingle("h", "headline", "footer")],
      [{ nodes: [heading("h", "headline")] }],
      undefined,
      { fieldsOf: ref => ("single" in ref ? [] : POSTS) }
    );
    expect(issues.map(issue => issue.severity)).toEqual(["error"]);
  });

  it("judges the document's own metadata bindings, a held one a warning", () => {
    const fresh = judged([], undefined, titled("headline"));
    expect(fresh).toEqual([
      expect.objectContaining({
        path: "/settings/seo/title/1",
        nodeId: "",
        code: "binding-field-missing",
        severity: "error",
      }),
    ]);
    // The binding to `title`, which the source has, is the control.
    expect(judged([], undefined, titled("title"))).toEqual([]);
    const stored = [{ nodes: [], settings: titled("headline") }];
    const held = judged([], stored, {
      seo: { title: [{ $bind: "headline", fallback: "this" }, " today"] },
    });
    expect(held.map(issue => [issue.path, issue.severity])).toEqual([
      ["/settings/seo/title/0", "warning"],
    ]);
    // A changed fallback makes it another binding, which is judged afresh.
    const changed = judged([], stored, {
      seo: { title: [{ $bind: "headline" }, " today"] },
    });
    expect(changed.map(issue => issue.severity)).toEqual(["error"]);
  });

  it("finds a timestamp missing where the shapes list timestamps, and judges it where they don't", () => {
    const listing: BindingSchemaSource = { ...schema, listsTimestamps: true };
    expect(
      judged([heading("h", "createdAt")], undefined, undefined, listing).map(
        issue => issue.code
      )
    ).toEqual(["binding-field-missing"]);
    expect(judged([heading("h", "createdAt")])).toEqual([]);
    // The id every entry has is never missing.
    expect(judged([heading("h", "id")], undefined, undefined, listing)).toEqual(
      []
    );
  });

  it("refuses a held binding whose fallback was changed", () => {
    const stored = [
      {
        nodes: [
          {
            ...heading("h", "headline"),
            bindings: { text: { $bind: "headline", fallback: "A" } },
          },
        ],
      },
    ];
    const issues = judged(
      [
        {
          ...heading("h", "headline"),
          bindings: { text: { $bind: "headline", fallback: "B" } },
        },
      ],
      stored
    );
    expect(issues.map(issue => issue.severity)).toEqual(["error"]);
  });

  it("holds a binding however its keys were ordered when stored", () => {
    // PostgreSQL's jsonb keeps keys in an order of its own, and the default
    // source may be spelled out or left implied.
    const stored = [
      {
        nodes: [
          {
            ...heading("h", "headline"),
            bindings: { text: { fallback: "A", $bind: "headline" } },
          },
        ],
      },
    ];
    const issues = judged(
      [
        {
          ...heading("h", "headline"),
          bindings: {
            text: { $bind: "headline", source: "entry", fallback: "A" },
          },
        },
      ],
      stored
    );
    expect(issues.map(issue => issue.severity)).toEqual(["warning"]);
  });

  it("judges no node past the cap, however wide the list", () => {
    const wide = Array.from({ length: 50_000 }, (_unused, index) =>
      heading(`h${String(index)}`, "headline")
    );
    const issues = bindingSchemaIssues(
      { nodes: wide },
      { schema, entry: { collection: "posts" }, maxNodes: 3 }
    );
    expect(issues.map(issue => issue.nodeId)).toEqual(["h0", "h1", "h2"]);
  });

  describe("a list's item bindings", () => {
    /** A heading binding `path` on the item of the list it is drawn in. */
    const itemHeading = (id: string, path: string) => ({
      ...heading(id, path),
      bindings: { text: { $bind: path, source: "item" } },
    });

    /** A list of `props`' source, its entries drawn with `children`. */
    const list = (
      props: Record<string, unknown>,
      children: unknown[],
      empty: unknown[] = []
    ) => ({
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { limit: 3, ...props },
      slots: { children, empty },
    });

    /** Posts as above, and a named query whose rows declare `price` alone. */
    const withQuery: BindingSchemaSource = {
      fieldsOf: ref =>
        "query" in ref && ref.query === "deals"
          ? [{ name: "price", type: "number" }]
          : schema.fieldsOf(ref),
    };

    it("judges an entry's binding against the list's collection", () => {
      const issues = judged([
        list({ collection: "posts" }, [
          itemHeading("missing", "headline"),
          itemHeading("present", "title"),
        ]),
      ]);
      expect(issues.map(issue => [issue.nodeId, issue.code])).toEqual([
        ["missing", "binding-field-missing"],
      ]);
    });

    it("keeps an item binding the stored page already held as a warning", () => {
      // Renamed after the page was saved: the page still saves.
      const page = [
        list({ collection: "posts" }, [itemHeading("h", "headline")]),
      ];
      const issues = judged(page, [{ nodes: page }]);
      expect(issues.map(issue => issue.severity)).toEqual(["warning"]);
    });

    it("judges a named query's rows against the query's declared fields", () => {
      const issues = judged(
        [
          list({ namedQuery: { name: "deals", params: {} } }, [
            itemHeading("gone", "title"),
            itemHeading("kept", "price"),
          ]),
        ],
        undefined,
        undefined,
        withQuery
      );
      expect(issues.map(issue => [issue.nodeId, issue.code])).toEqual([
        ["gone", "binding-field-missing"],
      ]);
    });

    it("judges a named query's entries of a collection against that collection", () => {
      // Rows declared as posts' entries bind as posts, as the render draws them.
      const issues = bindingSchemaIssues(
        {
          nodes: [
            list({ namedQuery: { name: "recent", params: {} } }, [
              itemHeading("missing", "headline"),
              itemHeading("present", "title"),
            ]),
          ],
        },
        {
          schema,
          entry: { collection: "posts" },
          namedQueries: {
            declarationOf: name =>
              name === "recent"
                ? ({ rows: { collection: "posts" } } as never)
                : undefined,
          },
        }
      );
      expect(issues.map(issue => [issue.nodeId, issue.code])).toEqual([
        ["missing", "binding-field-missing"],
      ]);
    });

    it("judges nothing against an item in the empty state, which draws none", () => {
      const issues = judged([
        list({ collection: "posts" }, [], [itemHeading("empty", "headline")]),
      ]);
      expect(
        issues.filter(issue => issue.code === "binding-field-missing")
      ).toEqual([]);
    });
  });
});
