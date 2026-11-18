/**
 * What a move into a group leaves behind: each property of the old column a JSON value has no
 * place for, named so the preview and the migration say it, and nothing else.
 */
import { describe, expect, it } from "vitest";

import { notCarried, notCarriedSentence } from "../not-carried";

describe("notCarried", () => {
  it("names the type, comment, character set, collation, indexes and foreign key, in that order", () => {
    expect(
      notCarried({
        type: "varchar(120)",
        comment: "Shown on cards",
        charset: "utf8mb4",
        collation: "utf8mb4_bin",
        indexes: ["idx_dc_posts_title", "idx_dc_posts_title_slug"],
        foreignKey: null,
      })
    ).toEqual([
      { property: "type", value: "varchar(120)" },
      { property: "comment", value: "Shown on cards" },
      { property: "character set", value: "utf8mb4" },
      { property: "collation", value: "utf8mb4_bin" },
      { property: "index", value: "idx_dc_posts_title" },
      { property: "index", value: "idx_dc_posts_title_slug" },
    ]);
  });

  it("names a NOT NULL the column had, which a key in JSON cannot hold", () => {
    expect(notCarried({ type: "text", nullable: false, indexes: [] })).toEqual([
      { property: "type", value: "text" },
      { property: "constraint", value: "NOT NULL" },
    ]);
    expect(notCarried({ type: "text", nullable: true, indexes: [] })).toEqual([
      { property: "type", value: "text" },
    ]);
  });

  it("names a foreign key, and only the type for a plain column", () => {
    expect(
      notCarried({
        type: "uuid",
        indexes: [],
        foreignKey: "fk_dc_posts_author",
      })
    ).toEqual([
      { property: "type", value: "uuid" },
      { property: "foreign key", value: "fk_dc_posts_author" },
    ]);
    expect(notCarried({ type: "text", indexes: [] })).toEqual([
      { property: "type", value: "text" },
    ]);
  });
});

describe("notCarriedSentence", () => {
  it("says what the move into the group does not carry", () => {
    expect(
      notCarriedSentence("Title", "Meta", [
        { property: "type", value: "varchar(120)" },
        { property: "index", value: "idx_dc_posts_title" },
      ])
    ).toBe(
      "Moving Title into Meta keeps every value; not carried, since a JSON value has no place for them: type varchar(120), index idx_dc_posts_title."
    );
  });
});
