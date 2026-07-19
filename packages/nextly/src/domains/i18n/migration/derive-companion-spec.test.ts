import { describe, it, expect } from "vitest";

import { deriveCompanionSpec } from "./derive-companion-spec";

const fields = [
  { name: "title", type: "text" },
  { name: "price", type: "number" },
  { name: "body", type: "richText" },
];

describe("deriveCompanionSpec", () => {
  it("builds a spec for the localized subset only", () => {
    const spec = deriveCompanionSpec({
      slug: "pages",
      fields,
      dialect: "sqlite",
      defaultLocale: "en",
      collectionLocalized: true,
    });
    expect(spec?.mainTable).toBe("dc_pages");
    expect(spec?.companionTable).toBe("dc_pages_locales");
    expect(spec?.parentIdType).toBe("TEXT");
    expect(spec?.defaultLocale).toBe("en");
    expect(spec?.columns.map(c => c.name)).toEqual(["title", "body"]);
  });

  it("uses VARCHAR(36) parent id on mysql", () => {
    const spec = deriveCompanionSpec({
      slug: "pages",
      fields,
      dialect: "mysql",
      defaultLocale: "en",
      collectionLocalized: true,
    });
    expect(spec?.parentIdType).toBe("VARCHAR(36)");
  });

  it("returns null when nothing is localized", () => {
    expect(
      deriveCompanionSpec({
        slug: "x",
        fields: [{ name: "price", type: "number" }],
        dialect: "sqlite",
        defaultLocale: "en",
        collectionLocalized: true,
      })
    ).toBeNull();
  });

  it("returns null when the collection switch is off", () => {
    expect(
      deriveCompanionSpec({
        slug: "x",
        fields,
        dialect: "sqlite",
        defaultLocale: "en",
        collectionLocalized: false,
      })
    ).toBeNull();
  });
});
