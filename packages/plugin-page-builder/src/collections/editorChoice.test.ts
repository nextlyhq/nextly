import { describe, expect, it } from "vitest";

import { FIELD_COMPONENT_PATH } from "./pageBuilderField";
import { editorChoiceFields } from "./editorChoice";

describe("editorChoiceFields", () => {
  it("returns an editorMode select, a page-builder field, and a normal rich-text field", () => {
    const fields = editorChoiceFields() as Record<string, unknown>[];
    expect(fields).toHaveLength(3);

    const [mode, builder, normal] = fields;
    expect(mode.type).toBe("select");
    expect(mode.name).toBe("editorMode");
    expect(mode.defaultValue).toBe("builder");

    expect(builder.name).toBe("content");
    expect((builder.admin as { component?: string }).component).toBe(
      FIELD_COMPONENT_PATH
    );
    expect(
      (builder.admin as { condition?: { equals?: string } }).condition?.equals
    ).toBe("builder");

    expect(normal.type).toBe("richText");
    expect(normal.name).toBe("body");
    expect(
      (normal.admin as { condition?: { equals?: string } }).condition?.equals
    ).toBe("normal");
  });

  it("honors custom field names + default mode", () => {
    const fields = editorChoiceFields({
      builderField: "layout",
      normalField: "richBody",
      defaultMode: "normal",
    }) as Record<string, unknown>[];
    expect(fields[0].defaultValue).toBe("normal");
    expect(fields[1].name).toBe("layout");
    expect(fields[2].name).toBe("richBody");
  });
});
