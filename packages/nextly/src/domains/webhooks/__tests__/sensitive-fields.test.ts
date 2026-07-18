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

  it("treats an admin-scoped hidden flag as sensitive", () => {
    // Real collection fields carry hidden under admin.hidden, not top-level.
    const names = sensitiveFieldNames([
      { name: "editorMode", type: "text", admin: { hidden: true } },
      { name: "title", type: "text", admin: { hidden: false } },
    ]);
    expect(names).toEqual(["editorMode"]);
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
