/**
 * A binding to an OUTER list's entry: an item binding naming the list it
 * reads (`list`), for a block inside a list inside another. The render reads
 * that list's entry, the save judges the path against that list's
 * collection, and a list the block is not inside is refused, as a list item
 * outside every list is.
 */
import { describe, expect, it } from "vitest";

import type { BindingFieldShape, BindingSchemaSource } from "./binding-rules";
import { bindingSchemaIssues } from "./binding-schema-issues";
import type { BlockNode } from "./document";
import { createBindingRun, resolveNodeBindings } from "./resolve-bindings";
import type { ValidationIssue } from "./validation-contract";
import { validBindingShape } from "./validation-bindings";

const CATEGORIES: readonly BindingFieldShape[] = [
  { name: "name", type: "text" },
];
const POSTS: readonly BindingFieldShape[] = [{ name: "title", type: "text" }];

const schema: BindingSchemaSource = {
  fieldsOf: ref => {
    if (!("collection" in ref)) return undefined;
    if (ref.collection === "categories") return CATEGORIES;
    return ref.collection === "posts" ? POSTS : undefined;
  },
};

/** A heading whose text binds `binding`. */
const heading = (id: string, binding: Record<string, unknown>) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: "Own text", level: "h2" },
  bindings: { text: binding },
});

/** A list of `collection`, its entries drawn with `children`. */
const list = (
  id: string,
  collection: string,
  children: unknown[],
  empty: unknown[] = []
) => ({
  id,
  type: "core/collection-loop",
  version: 1,
  props: { collection, limit: 3 },
  slots: { children, empty },
});

describe("an outer list's entry, drawn", () => {
  const run = createBindingRun({
    sources: {},
    schema,
    props: {
      get: type =>
        type === "core/heading"
          ? { props: { text: { type: "text" } } }
          : undefined,
    },
  });
  /** The heading drawn for one post inside one category's entry. */
  const drawn = (binding: Record<string, unknown>) =>
    resolveNodeBindings(heading("h", binding) as unknown as BlockNode, run, {
      phase: "item",
      item: { title: "Highway 9 realignment" },
      itemRef: { collection: "posts" },
      lists: new Map([
        [
          "categories",
          { item: { name: "Surveys" }, itemRef: { collection: "categories" } },
        ],
        [
          "posts",
          {
            item: { title: "Highway 9 realignment" },
            itemRef: { collection: "posts" },
          },
        ],
      ]),
    });

  it("reads the named list's entry", () => {
    const result = drawn({ $bind: "name", source: "item", list: "categories" });
    expect(result.issues).toEqual([]);
    expect(result.props.text).toBe("Surveys");
  });

  it("reads the nearest entry where no list is named, as before", () => {
    expect(drawn({ $bind: "title", source: "item" }).props.text).toBe(
      "Highway 9 realignment"
    );
  });

  it("refuses a list the block is not inside, and shows its fallback", () => {
    const result = drawn({
      $bind: "name",
      source: "item",
      list: "elsewhere",
      fallback: "A category",
    });
    expect(result.props.text).toBe("A category");
    expect(result.issues.map(issue => issue.code)).toEqual([
      "binding-source-unavailable",
    ]);
  });
});

describe("an outer list's entry, judged at save", () => {
  const judged = (nodes: readonly unknown[]) =>
    bindingSchemaIssues(
      { nodes },
      { schema, entry: { collection: "posts" } }
    ).map(issue => [issue.nodeId, issue.code]);

  it("judges the path against the named list's collection", () => {
    expect(
      judged([
        list("categories", "categories", [
          list("posts", "posts", [
            heading("kept", { $bind: "name", source: "item", list: "categories" }),
            // `title` is a post's, not a category's.
            heading("gone", { $bind: "title", source: "item", list: "categories" }),
            heading("inner", { $bind: "title", source: "item" }),
          ]),
        ]),
      ])
    ).toEqual([["gone", "binding-field-missing"]]);
  });

  it("refuses a list the block is not inside", () => {
    expect(
      judged([
        list("other", "categories", []),
        list("posts", "posts", [
          heading("h", { $bind: "name", source: "item", list: "other" }),
        ]),
      ])
    ).toEqual([["h", "binding-source-unavailable"]]);
  });

  it("keeps the outer list's entry in the inner list's empty state", () => {
    expect(
      judged([
        list("categories", "categories", [
          list(
            "posts",
            "posts",
            [],
            [heading("h", { $bind: "name", source: "item", list: "categories" })]
          ),
        ]),
      ])
    ).toEqual([]);
  });
});

describe("an outer list binding's shape", () => {
  const shapeIssues = (binding: unknown): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];
    validBindingShape(binding, "/b", issues);
    return issues;
  };

  it("names a list only on an item binding, by a non-empty id", () => {
    expect(
      shapeIssues({ $bind: "name", source: "item", list: "categories" })
    ).toEqual([]);
    expect(
      shapeIssues({ $bind: "name", source: "entry", list: "categories" })
    ).toEqual([expect.objectContaining({ path: "/b/list" })]);
    expect(shapeIssues({ $bind: "name", source: "item", list: "" })).toEqual([
      expect.objectContaining({ path: "/b/list" }),
    ]);
    expect(shapeIssues({ $bind: "name", source: "item", list: 3 })).toEqual([
      expect.objectContaining({ path: "/b/list" }),
    ]);
  });
});
