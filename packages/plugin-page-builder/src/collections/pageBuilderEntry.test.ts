import { defineSingle, text } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  PAGE_BUILDER_CONTENT_FIELD,
  PAGE_BUILDER_FIELD_TYPE,
  pageBuilderFields,
  withPageBuilder,
} from "./pageBuilderEntry";
import { FIELD_COMPONENT_PATH } from "./pageBuilderField";

describe("pageBuilderFields", () => {
  it("returns an editorMode select + the reserved content page-builder field", () => {
    const fields = pageBuilderFields() as Record<string, unknown>[];
    expect(fields).toHaveLength(2);

    const [mode, builder] = fields;
    expect(mode.type).toBe("select");
    expect(mode.name).toBe("editormode");
    expect(mode.defaultValue).toBe("default"); // default = normal editor
    // Hidden field: never rendered inline; surfaced as a toolbar toggle instead.
    expect((mode.admin as { hidden?: boolean }).hidden).toBe(true);

    expect(builder.name).toBe(PAGE_BUILDER_CONTENT_FIELD);
    expect((builder.admin as { component?: string }).component).toBe(
      FIELD_COMPONENT_PATH
    );
    expect(
      (builder.admin as { condition?: { equals?: string } }).condition?.equals
    ).toBe("builder");
  });

  it("honors a builder default mode", () => {
    const fields = pageBuilderFields({
      defaultMode: "builder",
    }) as Record<string, unknown>[];
    expect(fields[0].defaultValue).toBe("builder");
  });
});

describe("PAGE_BUILDER_FIELD_TYPE", () => {
  it("is a json-storage field type wired to the page-builder component", () => {
    expect(PAGE_BUILDER_FIELD_TYPE.type).toBe("page-builder");
    expect(PAGE_BUILDER_FIELD_TYPE.storage).toBe("json");
    expect(PAGE_BUILDER_FIELD_TYPE.component).toBe(FIELD_COMPONENT_PATH);
  });

  it("declares a takeover layout so the entry form hides sibling fields", () => {
    expect(PAGE_BUILDER_FIELD_TYPE.layout).toBe("takeover");
  });
});

describe("pageBuilderFields in a Single", () => {
  it("composes into defineSingle alongside normal fields", () => {
    const single = defineSingle({
      slug: "homepage",
      fields: [text({ name: "title" }), ...pageBuilderFields()],
    }) as { fields: Record<string, unknown>[] };
    const names = single.fields.map(f => f.name);
    expect(names).toContain("title");
    expect(names).toContain("editormode");
    expect(names).toContain(PAGE_BUILDER_CONTENT_FIELD);
  });
});

describe("withPageBuilder", () => {
  it("appends the editor-choice fields (presence is the signal — no admin flag)", () => {
    const config = withPageBuilder({
      slug: "landing",
      fields: [text({ name: "title" })],
    });
    const names = (config.fields as Record<string, unknown>[]).map(f => f.name);
    expect(names).toEqual(["title", "editormode", PAGE_BUILDER_CONTENT_FIELD]);
    // No longer writes admin.pageBuilder — the page-builder field is the signal.
    expect(
      (config as { admin?: { pageBuilder?: unknown } }).admin?.pageBuilder
    ).toBeUndefined();
  });

  it("preserves existing admin config + honors defaultMode on the select", () => {
    const config = withPageBuilder(
      { slug: "x", fields: [], admin: { group: "Content" } },
      { defaultMode: "builder" }
    );
    const admin = config.admin as { group?: string };
    expect(admin.group).toBe("Content");
    const mode = (config.fields as Record<string, unknown>[]).find(
      f => f.name === "editormode"
    );
    expect(mode?.defaultValue).toBe("builder");
  });
});
