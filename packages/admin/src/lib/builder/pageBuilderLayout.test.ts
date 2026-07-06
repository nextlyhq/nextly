import { describe, expect, it } from "vitest";

import { computeMainFields, isPageBuilderEnabled } from "./pageBuilderLayout";

const f = (name: string, type = "text") => ({ name, type });
// The canvas field is a `json` field wired to the plugin editor via admin.component.
const canvas = {
  name: "content",
  type: "json",
  admin: { component: "@nextlyhq/plugin-page-builder/admin#PageBuilderField" },
};
const schema = [
  f("title"),
  f("slug"),
  f("editormode", "select"),
  canvas,
  f("seo"),
];

describe("isPageBuilderEnabled", () => {
  it("true when the schema has an editormode + the plugin canvas field", () => {
    expect(isPageBuilderEnabled(schema, undefined)).toBe(true);
  });
  it("true for the legacy page-builder field type", () => {
    expect(
      isPageBuilderEnabled(
        [f("editormode", "select"), f("content", "page-builder")],
        undefined
      )
    ).toBe(true);
  });
  it("true when the code-first admin flag is set", () => {
    expect(
      isPageBuilderEnabled([f("x")], { pageBuilder: { enabled: true } })
    ).toBe(true);
  });
  it("false otherwise (a plain content field isn't enough)", () => {
    expect(isPageBuilderEnabled([f("content"), f("x")], undefined)).toBe(false);
  });
});

describe("computeMainFields", () => {
  it("in builder mode keeps only editormode + the canvas (no title/slug)", () => {
    const out = computeMainFields(schema, {
      enabled: true,
      editorMode: "builder",
    }).map(x => x.name);
    expect(out).toEqual(["editormode", "content"]);
  });
  it("in default mode returns all non-title/slug fields", () => {
    const out = computeMainFields(schema, {
      enabled: true,
      editorMode: "default",
    }).map(x => x.name);
    expect(out).toEqual(["editormode", "content", "seo"]);
  });
  it("when not enabled returns all non-title/slug fields regardless of mode", () => {
    const out = computeMainFields(schema, {
      enabled: false,
      editorMode: "builder",
    }).map(x => x.name);
    expect(out).toEqual(["editormode", "content", "seo"]);
  });
});
