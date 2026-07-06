import { describe, expect, it } from "vitest";

import {
  addPageBuilderFields,
  hasPageBuilderFields,
  removePageBuilderFields,
} from "./pageBuilderToggle.helpers";

const base = [{ id: "1", name: "title", type: "text" }];

describe("page builder toggle helpers", () => {
  it("adds editormode + a page-builder content field once (idempotent)", () => {
    const out = addPageBuilderFields(base);
    expect(out.some(f => f.name === "editormode")).toBe(true);
    expect(
      out.some(f => f.type === "page-builder" && f.name === "content")
    ).toBe(true);
    expect(hasPageBuilderFields(out)).toBe(true);
    expect(
      addPageBuilderFields(out).filter(f => f.name === "editormode")
    ).toHaveLength(1);
  });

  it("removes both fields", () => {
    const removed = removePageBuilderFields(addPageBuilderFields(base));
    expect(hasPageBuilderFields(removed)).toBe(false);
    expect(removed.map(f => f.name)).toEqual(["title"]);
  });
});
