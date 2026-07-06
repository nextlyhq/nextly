import { describe, expect, it } from "vitest";

import {
  addPageBuilderFields,
  hasPageBuilderFields,
  removePageBuilderFields,
} from "./pageBuilderToggle.helpers";

const base = [{ id: "1", name: "title", type: "text" }];

describe("page builder toggle helpers", () => {
  it("adds editormode + a json content field wired to the plugin editor (idempotent)", () => {
    const out = addPageBuilderFields(base);
    expect(out.some(f => f.name === "editormode")).toBe(true);
    const content = out.find(f => f.name === "content") as {
      type?: string;
      admin?: { component?: string };
    };
    expect(content?.type).toBe("json"); // storage primitive, not a custom type
    expect(content?.admin?.component).toContain("plugin-page-builder");
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
