import { describe, it, expect } from "vitest";

import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";

describe("fieldToLocalizedColumnSpec", () => {
  it("maps a text field to a text column spec", () => {
    expect(
      fieldToLocalizedColumnSpec(
        { name: "title", type: "text" },
        "postgresql",
        "codeFirst"
      )
    ).toMatchObject({ name: "title", kind: "text" });
  });

  it("maps richText to longText and structured types to json", () => {
    expect(
      fieldToLocalizedColumnSpec(
        { name: "body", type: "richText" },
        "sqlite",
        "codeFirst"
      )?.kind
    ).toBe("longText");
    expect(
      fieldToLocalizedColumnSpec(
        { name: "blocks", type: "repeater" },
        "sqlite",
        "codeFirst"
      )?.kind
    ).toBe("json");
  });

  it("uses the descriptor's snake_cased column name", () => {
    expect(
      fieldToLocalizedColumnSpec(
        { name: "metaTitle", type: "text" },
        "sqlite",
        "codeFirst"
      )?.name
    ).toBe("meta_title");
  });
});
