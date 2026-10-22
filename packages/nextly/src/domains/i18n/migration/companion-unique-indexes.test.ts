import { describe, expect, it } from "vitest";

import {
  companionUniqueIndexName,
  companionUniqueIndexStatements,
  uniqueTranslatedColumns,
} from "./companion-unique-indexes";

const fields = [
  { name: "slug", type: "text", unique: true },
  { name: "title", type: "text" },
  { name: "code", type: "text", unique: true, localized: false },
];

describe("a translated field's uniqueness within each language", () => {
  it("is asked of the translated fields marked unique, and only them", () => {
    expect(
      uniqueTranslatedColumns({
        fields,
        entityLocalized: true,
        dialect: "postgresql",
        builtBy: "collection",
      })
    ).toEqual([{ field: "slug", column: "slug" }]);
    expect(
      uniqueTranslatedColumns({
        fields,
        entityLocalized: false,
        dialect: "postgresql",
        builtBy: "collection",
      })
    ).toEqual([]);
  });

  it("keys the index on the value with blanks left out, and the language", () => {
    const [create] = companionUniqueIndexStatements({
      dialect: "postgresql",
      companionTable: "dc_posts_locales",
      wanted: [{ field: "slug", column: "slug" }],
      translatedColumns: ["slug", "title"],
      liveIndexNames: new Set(),
    });
    expect(create).toMatch(
      /^CREATE UNIQUE INDEX IF NOT EXISTS "[^"]+" ON "dc_posts_locales" \(NULLIF\("slug", ''\), "_locale"\)$/
    );
  });

  it("writes MySQL's functional key part in its own parentheses, with no IF NOT EXISTS", () => {
    const [create] = companionUniqueIndexStatements({
      dialect: "mysql",
      companionTable: "dc_posts_locales",
      wanted: [{ field: "slug", column: "slug" }],
      translatedColumns: ["slug"],
      liveIndexNames: new Set(),
    });
    expect(create).toMatch(
      /^CREATE UNIQUE INDEX `[^`]+` ON `dc_posts_locales` \(\(NULLIF\(`slug`, ''\)\), `_locale`\)$/
    );
  });

  it("creates only what is missing, and drops the index of a field no longer unique", () => {
    const name = companionUniqueIndexName("dc_posts_locales", "slug");
    expect(
      companionUniqueIndexStatements({
        dialect: "postgresql",
        companionTable: "dc_posts_locales",
        wanted: [{ field: "slug", column: "slug" }],
        translatedColumns: ["slug"],
        liveIndexNames: new Set([name]),
      })
    ).toEqual([]);
    expect(
      companionUniqueIndexStatements({
        dialect: "mysql",
        companionTable: "dc_posts_locales",
        wanted: [],
        translatedColumns: ["slug"],
        liveIndexNames: new Set([name]),
      })
    ).toEqual([`DROP INDEX \`${name}\` ON \`dc_posts_locales\``]);
  });

  it("names the index within every dialect's limit, whatever the table and field are called", () => {
    const name = companionUniqueIndexName(
      `dc_${"a".repeat(55)}_locales`,
      "b".repeat(60)
    );
    expect(name.length).toBeLessThanOrEqual(63);
    expect(
      companionUniqueIndexName(`dc_${"a".repeat(55)}_locales`, "c".repeat(60))
    ).not.toBe(name);
  });
});
