import { describe, expect, it } from "vitest";

import {
  companionUniqueIndexName,
  companionUniqueIndexStatements,
  uniqueColumnsWithKind,
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
    ).toEqual([{ field: "slug", column: "slug", text: true, kind: "text" }]);
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
      wanted: [{ field: "slug", column: "slug", text: true }],
      translatedColumns: ["slug", "title"],
      liveIndexNames: new Set(),
    });
    expect(create).toMatch(
      /^CREATE UNIQUE INDEX IF NOT EXISTS "[^"]+" ON "dc_posts_locales" \(NULLIF\("slug", ''\), "_locale"\)$/
    );
  });

  it("keys MySQL's functional key part on the hash of the value's collation weight, with no IF NOT EXISTS", () => {
    const [create] = companionUniqueIndexStatements({
      dialect: "mysql",
      companionTable: "dc_posts_locales",
      wanted: [{ field: "slug", column: "slug", text: true }],
      translatedColumns: ["slug"],
      liveIndexNames: new Set(),
    });
    expect(create).toMatch(
      /^CREATE UNIQUE INDEX `[^`]+` ON `dc_posts_locales` \(\(SHA2\(WEIGHT_STRING\(NULLIF\(`slug`, ''\)\), 256\)\), `_locale`\)$/
    );
  });

  // SQLite keys the column itself and leaves blanks and NULLs out by a WHERE, since the tool the
  // schema pipeline reads SQLite with refuses a unique index over several columns with an
  // expression among them.
  it("keys SQLite's text index on the value and the language, leaving blanks out by its WHERE", () => {
    const [create] = companionUniqueIndexStatements({
      dialect: "sqlite",
      companionTable: "dc_posts_locales",
      wanted: [{ field: "slug", column: "slug", text: true }],
      translatedColumns: ["slug"],
      liveIndexNames: new Set(),
    });
    expect(create).toMatch(
      /^CREATE UNIQUE INDEX IF NOT EXISTS "[^"]+" ON "dc_posts_locales" \("slug", "_locale"\) WHERE "slug" IS NOT NULL AND "slug" <> ''$/
    );
    expect(create).not.toMatch(/NULLIF/);
  });

  it("keys SQLite's index on a column that is not text over every row, with no WHERE", () => {
    const [create] = companionUniqueIndexStatements({
      dialect: "sqlite",
      companionTable: "dc_posts_locales",
      wanted: [{ field: "rank", column: "rank", text: false }],
      translatedColumns: ["rank"],
      liveIndexNames: new Set(),
    });
    expect(create).toMatch(/ON "dc_posts_locales" \("rank", "_locale"\)$/);
  });

  it("keys a column that is not text as it is, on every dialect, since only text has a blank", () => {
    const columns = uniqueTranslatedColumns({
      fields: [{ name: "rank", type: "number", unique: true, localized: true }],
      entityLocalized: true,
      dialect: "postgresql",
      builtBy: "collection",
    });
    expect(columns).toEqual([
      { field: "rank", column: "rank", text: false, kind: "integer" },
    ]);
    const [pg] = companionUniqueIndexStatements({
      dialect: "postgresql",
      companionTable: "dc_posts_locales",
      wanted: columns,
      translatedColumns: ["rank"],
      liveIndexNames: new Set(),
    });
    expect(pg).toMatch(/ON "dc_posts_locales" \("rank", "_locale"\)$/);
    const [mysql] = companionUniqueIndexStatements({
      dialect: "mysql",
      companionTable: "dc_posts_locales",
      wanted: columns,
      translatedColumns: ["rank"],
      liveIndexNames: new Set(),
    });
    expect(mysql).toMatch(/ON `dc_posts_locales` \(`rank`, `_locale`\)$/);
  });

  it("creates only what is missing, and drops the index of a field no longer unique", () => {
    const name = companionUniqueIndexName("dc_posts_locales", "slug");
    expect(
      companionUniqueIndexStatements({
        dialect: "postgresql",
        companionTable: "dc_posts_locales",
        wanted: [{ field: "slug", column: "slug", text: true }],
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

  it("drops an index once, however many times its column is listed", () => {
    const name = companionUniqueIndexName("dc_posts_locales", "slug");
    expect(
      companionUniqueIndexStatements({
        dialect: "mysql",
        companionTable: "dc_posts_locales",
        wanted: [],
        translatedColumns: ["slug", "slug"],
        liveIndexNames: new Set([name]),
      })
    ).toHaveLength(1);
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

  it("holds a one-to-one relationship unique without an explicit flag, as a shared column does", () => {
    const oneToOne = {
      name: "author",
      type: "relationship",
      localized: true,
      options: { relationType: "oneToOne", collection: "authors" },
    };
    const columns = uniqueTranslatedColumns({
      fields: [oneToOne],
      entityLocalized: true,
      dialect: "postgresql",
      builtBy: "collection",
    });
    expect(columns.map(c => c.field)).toEqual(["author"]);
    expect(columns[0]?.text).toBe(false);
  });

  it("leaves a relationship that is not one-to-one alone", () => {
    expect(
      uniqueTranslatedColumns({
        fields: [
          {
            name: "tags",
            type: "relationship",
            localized: true,
            options: { relationType: "oneToMany", collection: "tags" },
          },
        ],
        entityLocalized: true,
        dialect: "postgresql",
        builtBy: "collection",
      })
    ).toEqual([]);
  });

  it("carries each column's storage kind, so a caller can judge what the dialect can key", () => {
    const [slug] = uniqueTranslatedColumns({
      fields: [{ name: "slug", type: "text", unique: true, localized: true }],
      entityLocalized: true,
      dialect: "postgresql",
      builtBy: "collection",
    });
    expect(slug?.kind).toBe("text");
    const [payload] = uniqueTranslatedColumns({
      fields: [
        { name: "payload", type: "json", unique: true, localized: true },
      ],
      entityLocalized: true,
      dialect: "mysql",
      builtBy: "collection",
    });
    expect(payload?.kind).toBe("json");
  });

  it("keeps a recorded column's kind, and reads an unrecorded one as text", () => {
    expect(
      uniqueColumnsWithKind(
        [
          { field: "rank", column: "rank" },
          { field: "gone", column: "gone" },
        ],
        [{ name: "rank", kind: "integer" }]
      )
    ).toEqual([
      { field: "rank", column: "rank", text: false, kind: "integer" },
      { field: "gone", column: "gone", text: true },
    ]);
  });

  it("takes the kind an entry carries over the companion's columns, so a dropped column keeps its own", () => {
    expect(
      uniqueColumnsWithKind(
        [{ field: "rank", column: "rank", kind: "integer" }],
        []
      )
    ).toEqual([
      { field: "rank", column: "rank", text: false, kind: "integer" },
    ]);
  });
});
