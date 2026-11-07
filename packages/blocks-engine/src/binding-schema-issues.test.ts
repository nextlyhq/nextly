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
    const held = judged([], [{ nodes: [], settings: titled("headline") }], {
      seo: { title: [{ $bind: "headline" }, " today"] },
    });
    expect(held.map(issue => [issue.path, issue.severity])).toEqual([
      ["/settings/seo/title/0", "warning"],
    ]);
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
});
