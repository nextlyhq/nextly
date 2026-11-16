import { describe, it, expect } from "vitest";

import { getColumnDescriptor } from "../../schema/services/field-column-descriptor";

import { deriveCompanionSpec } from "./derive-companion-spec";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import { buildLocalizationDownStatements } from "./generate-down";

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

describe("a translated unique text field that states no width, on MySQL", () => {
  const handle = { name: "handle", type: "text", unique: true } as const;

  it("keeps its translations column unbounded, where a shared one is bounded to be keyed", () => {
    // The shared column carries a whole-column key, so MySQL needs it bounded; the translated one
    // is keyed per language by an expression or a prefix, so it keeps the Builder's TEXT.
    expect(
      getColumnDescriptor(handle, "mysql", "collection")?.dialectType
    ).toBe("varchar(255)");
    expect(
      fieldToLocalizedColumnSpec(handle, "mysql", "collection")
    ).toMatchObject({ name: "handle", kind: "longText" });
  });

  it("is restored by a localization disable into TEXT, so no value is cut", () => {
    const spec = deriveCompanionSpec({
      builtBy: "collection",
      slug: "pages",
      dbName: "dc_pages",
      fields: [handle],
      dialect: "mysql",
      defaultLocale: "en",
      collectionLocalized: true,
      status: false,
      kind: "collection",
    });
    if (spec === null) throw new Error("a translated field has a companion");
    const readd = buildLocalizationDownStatements(spec).filter(statement =>
      /ADD COLUMN `handle`/i.test(statement)
    );
    expect(readd).toHaveLength(1);
    // A TEXT-family column, never the bounded `varchar(255)` a shared unique field gets.
    expect(readd[0], readd[0]).toMatch(/ADD COLUMN `handle` \w*text/i);
    expect(readd[0]).not.toMatch(/varchar/i);
  });
});
