import { describe, expect, it } from "vitest";

import {
  PAGE_BUILDER_CONTENT_FIELD,
  PAGE_BUILDER_FIELD_TYPE,
  pageBuilderFields,
} from "./pageBuilderEntry";
import { FIELD_COMPONENT_PATH } from "./pageBuilderField";

describe("pageBuilderFields", () => {
  it("returns an editorMode select + the reserved content page-builder field", () => {
    const fields = pageBuilderFields() as Record<string, unknown>[];
    expect(fields).toHaveLength(2);

    const [mode, builder] = fields;
    expect(mode.type).toBe("select");
    expect(mode.name).toBe("editorMode");
    expect(mode.defaultValue).toBe("default"); // default = normal editor

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
});
