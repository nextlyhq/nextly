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

const judged = (nodes: readonly unknown[], stored?: readonly unknown[]) =>
  bindingSchemaIssues(nodes, {
    schema,
    entry: { collection: "posts" },
    ...(stored === undefined ? {} : { stored }),
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
});
