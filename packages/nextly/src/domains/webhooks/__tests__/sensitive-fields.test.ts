import { describe, it, expect } from "vitest";

import { sensitiveFieldPaths } from "../sensitive-fields";

describe("sensitiveFieldPaths", () => {
  it("collects password fields and hidden fields, skips the rest", () => {
    const names = sensitiveFieldPaths([
      { name: "title", type: "text" },
      { name: "secret", type: "password" },
      { name: "internalNote", type: "text", hidden: true },
      { name: "status", type: "select" },
    ]);
    expect(names.sort()).toEqual(["internalNote", "secret"]);
  });

  it("walks nested group/repeater fields at any depth", () => {
    const names = sensitiveFieldPaths([
      {
        name: "profile",
        type: "group",
        fields: [
          { name: "displayName", type: "text" },
          { name: "apiKey", type: "password" },
        ],
      },
      {
        name: "rows",
        type: "repeater",
        fields: [
          {
            name: "row",
            type: "group",
            fields: [{ name: "token", type: "password" }],
          },
        ],
      },
    ]);
    expect(names.sort()).toEqual(["profile.apiKey", "rows.row.token"]);
  });

  it("walks per-block fields of a blocks field", () => {
    const names = sensitiveFieldPaths([
      {
        name: "content",
        type: "blocks",
        blocks: [
          { fields: [{ name: "heading", type: "text" }] },
          { fields: [{ name: "apiKey", type: "password" }] },
        ],
      },
    ]);
    expect(names).toEqual(["content.apiKey"]);
  });

  it("treats an admin-scoped hidden flag as sensitive", () => {
    // Real collection fields carry hidden under admin.hidden, not top-level.
    const names = sensitiveFieldPaths([
      { name: "editorMode", type: "text", admin: { hidden: true } },
      { name: "title", type: "text", admin: { hidden: false } },
    ]);
    expect(names).toEqual(["editorMode"]);
  });

  it("strips all children of a hidden (even nameless) group", () => {
    // A hidden presentational group makes everything under it sensitive, so no
    // child leaks just because it was not individually marked hidden.
    const names = sensitiveFieldPaths([
      {
        type: "group",
        admin: { hidden: true },
        fields: [
          { name: "internalA", type: "text" },
          { name: "internalB", type: "number" },
        ],
      },
    ]);
    expect(names.sort()).toEqual(["internalA", "internalB"]);
  });

  it("does not propagate hidden into a NAMED container's children", () => {
    // A named hidden group is dropped whole by its own name, so its child
    // names must not join the deny-list (that would strip unrelated fields of
    // the same name, e.g. a top-level "title").
    const names = sensitiveFieldPaths([
      {
        name: "seo",
        type: "group",
        admin: { hidden: true },
        fields: [{ name: "title", type: "text" }],
      },
      { name: "title", type: "text" },
    ]);
    expect(names).toEqual(["seo"]);
  });

  it("keeps same-named fields apart by path", () => {
    const names = sensitiveFieldPaths([
      { name: "secret", type: "password" },
      {
        name: "block",
        type: "group",
        fields: [{ name: "secret", hidden: true }],
      },
    ]);
    expect(names.sort()).toEqual(["block.secret", "secret"]);
  });

  it("scopes a nested sensitive name so a same-named sibling survives", () => {
    // The failure this prevents: a bare `title` in the deny list strips the
    // document's own title at every depth, so a legitimate change silently
    // vanishes from the payload and from changedFields.
    const paths = sensitiveFieldPaths([
      { name: "title", type: "text" },
      {
        name: "profile",
        type: "group",
        fields: [{ name: "title", type: "text", admin: { hidden: true } }],
      },
    ]);
    expect(paths).toEqual(["profile.title"]);
    expect(paths).not.toContain("title");
  });

  it("returns an empty list when nothing is sensitive", () => {
    expect(sensitiveFieldPaths([{ name: "title", type: "text" }])).toEqual([]);
  });
});
