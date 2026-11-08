/**
 * A link whose entry id is bound to a related entry's id, judged at save
 * against its Linked collection: the collection the relation points at, or
 * the link finds no entry and draws nothing, silently.
 */
import { describe, expect, it } from "vitest";

import type { BindingFieldShape, BindingSchemaSource } from "./binding-rules";
import { bindingSchemaIssues } from "./binding-schema-issues";

/** A post's author, one user, and its editors, many. */
const POSTS: readonly BindingFieldShape[] = [
  { name: "title", type: "text" },
  { name: "author", type: "relationship", relationTo: "users" },
  {
    name: "editors",
    type: "relationship",
    relationTo: "users",
    hasMany: true,
  },
];

/**
 * The users' fields, `id` declared, so a path to it is found whether or not
 * the rules count a related entry's `id` as a field every entry carries.
 */
const USERS: readonly BindingFieldShape[] = [
  { name: "id", type: "text" },
  { name: "name", type: "text" },
];

const schema: BindingSchemaSource = {
  fieldsOf: ref => {
    if (!("collection" in ref)) return undefined;
    if (ref.collection === "posts") return POSTS;
    return ref.collection === "users" ? USERS : undefined;
  },
};

/** A button linking to the entry `path` names, its Linked collection as given. */
const button = (
  path: string,
  props: Record<string, unknown>,
  bindings: Record<string, unknown> = {}
) => ({
  id: "b",
  type: "core/button",
  version: 1,
  props: { label: "Read the author", ...props },
  bindings: { entryId: { $bind: path }, ...bindings },
});

const judged = (node: unknown, stored?: readonly unknown[]) =>
  bindingSchemaIssues(
    { nodes: [node] },
    {
      schema,
      entry: { collection: "posts" },
      ...(stored === undefined ? {} : { stored }),
    }
  );

/** The mismatch findings among a judgement's issues. */
const mismatches = (issues: ReturnType<typeof judged>) =>
  issues.filter(issue => issue.code === "binding-entry-collection-mismatch");

describe("a link bound to a related entry, judged at save", () => {
  it("refuses a Linked collection other than the one the relation points at", () => {
    const issues = mismatches(
      judged(button("author.id", { entryCollection: "pages" }))
    );
    expect(issues).toEqual([
      expect.objectContaining({
        path: "/nodes/0/bindings/entryId",
        nodeId: "b",
        severity: "error",
      }),
    ]);
    // Both collections named, and what to set.
    expect(issues[0]?.message).toContain('"pages"');
    expect(issues[0]?.message).toContain('Set Linked collection to "users"');
  });

  it("refuses a link with no Linked collection, saying which to set", () => {
    const issues = mismatches(judged(button("author.id", {})));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("not set");
    expect(issues[0]?.message).toContain('"users"');
  });

  it("accepts the Linked collection the relation points at", () => {
    // The control for the two above: the same link, the right collection.
    expect(
      mismatches(judged(button("author.id", { entryCollection: "users" })))
    ).toEqual([]);
  });

  it("leaves a Linked collection that is itself bound to the page", () => {
    // Read per page, so nothing here can say which collection it will hold.
    const issues = judged(
      button(
        "author.id",
        { entryCollection: "pages" },
        { entryCollection: { $bind: "title" } }
      )
    );
    expect(mismatches(issues)).toEqual([]);
  });

  it("judges only a related entry's id, not another field read into the id", () => {
    // `author.name` is no entry's id: the collection is not this check's.
    expect(
      mismatches(judged(button("author.name", { entryCollection: "pages" })))
    ).toEqual([]);
  });

  it("keeps a mismatch the stored page already held as a warning, and refuses a changed one", () => {
    const held = button("author.id", { entryCollection: "pages" });
    const kept = mismatches(judged(held, [{ nodes: [held] }]));
    expect(kept.map(issue => issue.severity)).toEqual(["warning"]);
    // Changed to another wrong collection: a new problem, refused.
    const changed = mismatches(
      judged(button("author.id", { entryCollection: "tags" }), [
        { nodes: [held] },
      ])
    );
    expect(changed.map(issue => issue.severity)).toEqual(["error"]);
  });
});
