import { describe, it, expect } from "vitest";

import { sensitiveFieldNames } from "../sensitive-fields";

describe("sensitiveFieldNames", () => {
  it("collects password fields and hidden fields, skips the rest", () => {
    const names = sensitiveFieldNames([
      { name: "title", type: "text" },
      { name: "secret", type: "password" },
      { name: "internalNote", type: "text", hidden: true },
      { name: "status", type: "select" },
    ]);
    expect(names.sort()).toEqual(["internalNote", "secret"]);
  });

  it("walks nested group/repeater fields at any depth", () => {
    const names = sensitiveFieldNames([
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
    expect(names.sort()).toEqual(["apiKey", "token"]);
  });

  it("walks per-block fields of a blocks field", () => {
    const names = sensitiveFieldNames([
      {
        name: "content",
        type: "blocks",
        blocks: [
          { fields: [{ name: "heading", type: "text" }] },
          { fields: [{ name: "apiKey", type: "password" }] },
        ],
      },
    ]);
    expect(names).toEqual(["apiKey"]);
  });

  it("treats an admin-scoped hidden flag as sensitive", () => {
    // Real collection fields carry hidden under admin.hidden, not top-level.
    const names = sensitiveFieldNames([
      { name: "editorMode", type: "text", admin: { hidden: true } },
      { name: "title", type: "text", admin: { hidden: false } },
    ]);
    expect(names).toEqual(["editorMode"]);
  });

  it("strips all children of a hidden (even nameless) group", () => {
    // A hidden presentational group makes everything under it sensitive, so no
    // child leaks just because it was not individually marked hidden.
    const names = sensitiveFieldNames([
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
    const names = sensitiveFieldNames([
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

  it("deduplicates repeated field names", () => {
    const names = sensitiveFieldNames([
      { name: "secret", type: "password" },
      {
        name: "block",
        type: "group",
        fields: [{ name: "secret", hidden: true }],
      },
    ]);
    expect(names).toEqual(["secret"]);
  });

  it("returns an empty list when nothing is sensitive", () => {
    expect(sensitiveFieldNames([{ name: "title", type: "text" }])).toEqual([]);
  });
});
