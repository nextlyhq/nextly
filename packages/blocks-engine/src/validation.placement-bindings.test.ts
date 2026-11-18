/**
 * A component placement's bindings: each binds one of its settings, under
 * `overrides.<setting id>`, and is judged at save where the placement sits,
 * as any block's binding is: against the entries of the list it is in, and
 * refused where it names a list it is not inside.
 */
import { describe, expect, it } from "vitest";

import type { BindingFieldShape, BindingSchemaSource } from "./binding-rules";
import { bindingSchemaIssues } from "./binding-schema-issues";
import { COMPONENT_INSTANCE_TYPE, type BlockNode } from "./document";
import type { ValidationIssue } from "./validation-contract";
import { validateBindings } from "./validation-bindings";

const POSTS: readonly BindingFieldShape[] = [{ name: "title", type: "text" }];

const schema: BindingSchemaSource = {
  fieldsOf: ref =>
    "collection" in ref && ref.collection === "posts" ? POSTS : undefined,
};

/** A placement of the card, its settings bound as given. */
const placement = (id: string, bindings: Record<string, unknown>) => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: "card" },
  bindings,
});

/** A list of posts, its entries drawn with `children`. */
const list = (id: string, children: unknown[]) => ({
  id,
  type: "core/collection-loop",
  version: 1,
  props: { collection: "posts", limit: 3 },
  slots: { children, empty: [] },
});

const byTitle = { $bind: "title", source: "item" };

describe("a placement's bindings, by shape", () => {
  const issuesOf = (bindings: Record<string, unknown>) => {
    const issues: ValidationIssue[] = [];
    validateBindings(
      placement("p", bindings) as unknown as BlockNode,
      "/nodes/0",
      issues
    );
    return issues.map(issue => [issue.path, issue.code]);
  };

  it("takes a binding of one setting, by its id", () => {
    expect(issuesOf({ "overrides.headline": byTitle })).toEqual([]);
  });

  it("refuses a key that names no setting", () => {
    expect(
      issuesOf({
        text: byTitle,
        overrides: byTitle,
        "overrides.": byTitle,
        "overrides.headline.more": byTitle,
      })
    ).toEqual([
      ["/nodes/0/bindings/text", "invalid-binding"],
      ["/nodes/0/bindings/overrides", "invalid-binding"],
      ["/nodes/0/bindings/overrides.", "invalid-binding"],
      ["/nodes/0/bindings/overrides.headline.more", "invalid-binding"],
    ]);
  });

  it("leaves a block's own prop keys alone", () => {
    const issues: ValidationIssue[] = [];
    validateBindings(
      {
        id: "h",
        type: "core/heading",
        version: 1,
        props: {},
        bindings: { "overrides.headline": byTitle, text: byTitle },
      } as unknown as BlockNode,
      "/nodes/0",
      issues
    );
    expect(issues).toEqual([]);
  });
});

describe("a placement's bindings, judged at save", () => {
  const judged = (nodes: readonly unknown[]) =>
    bindingSchemaIssues(
      { nodes },
      { schema, entry: { collection: "posts" } }
    ).map(issue => [issue.nodeId, issue.code]);

  it("judges a list item binding against the list the placement is in", () => {
    expect(
      judged([
        list("posts", [
          placement("kept", { "overrides.headline": byTitle }),
          placement("gone", {
            "overrides.headline": { $bind: "nope", source: "item" },
          }),
        ]),
      ])
    ).toEqual([["gone", "binding-field-missing"]]);
  });

  it("refuses a list the placement is not inside", () => {
    expect(
      judged([
        list("posts", []),
        placement("alone", {
          "overrides.headline": { ...byTitle, list: "posts" },
        }),
      ])
    ).toEqual([["alone", "binding-source-unavailable"]]);
  });
});
