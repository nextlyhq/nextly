/**
 * A link to the entry a to-one relation names: `author.id` is the related
 * entry's own id, read across the one relation a path may follow, so a
 * link's `entryId` can name it. It is read as the public reads the related
 * entry, so an author a visitor may not read gives nothing and the link
 * falls back. A relation that names several entries, or entries of several
 * collections, gives no single entry of one collection, and is refused.
 */
import { describe, expect, it } from "vitest";

import {
  checkBinding,
  type BindingFieldShape,
  type BindingSchemaSource,
} from "./binding-rules";
import type { PropSchema } from "./block";
import type { BlockNode } from "./document";
import {
  bindingDemand,
  createBindingRun,
  resolveNodeBindings,
} from "./resolve-bindings";

const POSTS: readonly BindingFieldShape[] = [
  { name: "title", type: "text" },
  { name: "author", type: "relationship", relationTo: "authors" },
  { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
  { name: "ref", type: "relationship", relationTo: ["authors", "tags"] },
  { name: "meta", type: "group", fields: [{ name: "note", type: "text" }] },
];

/** The authors' declared fields: none is called `id`, as in a real schema. */
const AUTHORS: readonly BindingFieldShape[] = [{ name: "name", type: "text" }];

const FIELDS: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  posts: POSTS,
  authors: AUTHORS,
};

const schema: BindingSchemaSource = {
  // As the save reads shapes: timestamps listed where a source has them.
  listsTimestamps: true,
  fieldsOf: ref =>
    "collection" in ref && Object.hasOwn(FIELDS, ref.collection)
      ? FIELDS[ref.collection]
      : undefined,
};

/** A link's props, as a linking block declares them. */
const LINK: Readonly<Record<string, PropSchema>> = {
  entryCollection: { type: "text" },
  entryId: { type: "text" },
};

const check = (path: string) =>
  checkBinding({
    nodeId: "b",
    prop: "entryId",
    binding: { $bind: path },
    props: LINK,
    schema,
    refs: { entry: { collection: "posts" } },
  });

const codes = (path: string) => check(path).issues.map(issue => issue.code);

describe("a link's entry bound to a to-one relation's id", () => {
  it("accepts the related entry's id", () => {
    const checked = check("author.id");
    expect(checked.outcome).toBe("resolve");
    expect(checked.issues).toEqual([]);
  });

  it("refuses what names no single entry of one collection", () => {
    // Every entry the relation names: which one would the link take?
    expect(codes("tags.id")).toEqual(["binding-path-to-many"]);
    // Entries of several collections, while the link names one collection.
    expect(codes("ref.id")).toEqual(["binding-path-unsupported"]);
  });

  it("refuses the relation itself, a group's id, a path past the id and a missing field", () => {
    // The stored id is the post's, read whether or not a visitor may read
    // the author: it never fills the link.
    expect(codes("author")).toEqual(["binding-type-misfit"]);
    // A group is not an entry and has no id.
    expect(codes("meta.id")).toEqual(["binding-field-missing"]);
    expect(codes("author.id.value")).toEqual(["binding-field-missing"]);
    expect(codes("author.nickname")).toEqual(["binding-field-missing"]);
    // A related entry's timestamps are missing where the shapes list them,
    // as the source's own are.
    expect(codes("author.createdAt")).toEqual(["binding-field-missing"]);
  });

  it("is read through the relation, and fills the link from the related entry", () => {
    const button: BlockNode = {
      id: "b",
      type: "core/button",
      version: 1,
      props: { label: "Author", entryCollection: "authors" },
      bindings: { entryId: { $bind: "author.id" } },
    };
    expect(
      bindingDemand([
        { formatVersion: 1, kind: "page", nodes: [button] },
      ]).entry?.follows.get("author")
    ).toEqual(["id"]);
    const runFor = (entry: Record<string, unknown>) =>
      createBindingRun({
        sources: { entry },
        entryRef: { collection: "posts" },
        schema,
        props: {
          get: type =>
            type === "core/button" ? { props: { ...LINK } } : undefined,
        },
      });
    // The author as the public read it, in place of its id.
    const read = resolveNodeBindings(
      button,
      runFor({ author: { id: "a1", name: "Ada" } }),
      { phase: "page" }
    );
    expect(read.issues).toEqual([]);
    expect(read.props.entryId).toBe("a1");
    // An author the public may not read stays the post's stored id: the
    // link names no entry, and keeps its own props.
    const unread = resolveNodeBindings(button, runFor({ author: "a1" }), {
      phase: "page",
    });
    expect(unread.props.entryId).toBeUndefined();
  });
});
