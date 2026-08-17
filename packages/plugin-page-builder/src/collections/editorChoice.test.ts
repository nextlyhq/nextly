import { describe, expect, it } from "vitest";

import { BLOCKS_TYPE } from "../fields/blocksField";
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
    // The TYPE, not a per-field component path. The previous editor's helper
    // stamped `admin.component` onto every field it produced; the blocks field
    // declares its component once on the registered field type, so a call site
    // names the type and the admin resolves the component from it. Asserting a
    // component here again would re-introduce the duplication as a test.
    expect(builder.type).toBe(BLOCKS_TYPE);
    expect((builder.admin as { component?: string }).component).toBeUndefined();
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
