/**
 * Which live UNIQUE constraints a save keeps: those a desired field still
 * makes unique, found under their live names when this apply renames the
 * table or the column, and none this apply drops itself.
 */
import { describe, expect, it } from "vitest";

import type { NextlySchemaSnapshot, Operation } from "../diff/types";
import {
  desiredUniqueColumns,
  liveTableName,
  liveUniqueConstraintsToKeep,
  renamesOf,
  uniqueColumnsToKeep,
} from "../live-uniques";
import type { DesiredSchema } from "../types";

const relationship = (name: string, relationType: string) => ({
  name,
  type: "relationship",
  options: { target: "authors", relationType },
});

function desired(fields: unknown[], tableName = "dc_posts"): DesiredSchema {
  return {
    collections: {
      posts: { slug: "posts", tableName, fields: fields as never },
    },
    singles: {},
    components: {},
  };
}

const NO_RENAMES = renamesOf([]);

describe("desiredUniqueColumns", () => {
  it("names a one-to-one's column and a field marked unique, not a many-to-one's", () => {
    expect(
      desiredUniqueColumns(
        desired([
          relationship("mainProfile", "oneToOne"),
          relationship("leadAuthor", "manyToOne"),
          { name: "code", type: "text", unique: true },
          { name: "title", type: "text" },
        ])
      )
    ).toEqual(new Map([["dc_posts", new Set(["main_profile", "code"])]]));
  });
});

describe("uniqueColumnsToKeep", () => {
  const wanted = desiredUniqueColumns(
    desired([relationship("profile", "oneToOne")])
  );

  it("keeps a live single-column UNIQUE a field still makes unique", () => {
    expect(
      uniqueColumnsToKeep("dc_posts", [["profile"]], NO_RENAMES, wanted)
    ).toEqual(["profile"]);
  });

  it("lets go of one whose field is no longer one-to-one", () => {
    const now = desiredUniqueColumns(
      desired([relationship("profile", "manyToOne")])
    );
    expect(
      uniqueColumnsToKeep("dc_posts", [["profile"]], NO_RENAMES, now)
    ).toEqual([]);
  });

  it("finds one under the column's live name when this apply renames it", () => {
    const renamed = desiredUniqueColumns(
      desired([relationship("mainProfile", "oneToOne")])
    );
    const renames = renamesOf([
      {
        type: "rename_column",
        tableName: "dc_posts",
        fromColumn: "profile",
        toColumn: "main_profile",
        fromType: "text",
        toType: "text",
      },
    ]);
    expect(
      uniqueColumnsToKeep("dc_posts", [["profile"]], renames, renamed)
    ).toEqual(["main_profile"]);
    // Without the rename the live name matches nothing the field declares.
    expect(
      uniqueColumnsToKeep("dc_posts", [["profile"]], NO_RENAMES, renamed)
    ).toEqual([]);
  });

  it("leaves a constraint over several columns alone", () => {
    expect(
      uniqueColumnsToKeep("dc_posts", [["profile", "slug"]], NO_RENAMES, wanted)
    ).toEqual([]);
  });
});

describe("liveUniqueConstraintsToKeep", () => {
  const live: NextlySchemaSnapshot = {
    tables: [
      {
        name: "dc_articles",
        columns: [],
        indexes: [
          {
            name: "dc_articles_profile_key",
            columns: ["profile"],
            unique: true,
          },
          {
            name: "idx_dc_articles_profile",
            columns: ["profile"],
            unique: false,
          },
        ],
      },
    ],
  } as never;

  it("keeps the live constraint under the table's desired name across a table rename", () => {
    const ops: Operation[] = [
      { type: "rename_table", fromName: "dc_articles", toName: "dc_posts" },
    ];
    const renames = renamesOf(ops);
    expect(liveTableName("dc_posts", renames)).toBe("dc_articles");
    expect(
      liveUniqueConstraintsToKeep(
        live,
        ops,
        renames,
        desiredUniqueColumns(desired([relationship("profile", "oneToOne")]))
      )
    ).toEqual(new Set(["dc_posts.dc_articles_profile_key"]));
  });

  it("keeps none this apply drops itself, and none a field no longer asks for", () => {
    const wanted = desiredUniqueColumns(
      desired([relationship("profile", "oneToOne")], "dc_articles")
    );
    const drop: Operation = {
      type: "drop_index",
      tableName: "dc_articles",
      index: {
        name: "dc_articles_profile_key",
        columns: ["profile"],
        unique: true,
      },
    };
    expect(
      liveUniqueConstraintsToKeep(live, [drop], NO_RENAMES, wanted)
    ).toEqual(new Set());
    expect(
      liveUniqueConstraintsToKeep(
        live,
        [],
        NO_RENAMES,
        desiredUniqueColumns(
          desired([relationship("profile", "manyToOne")], "dc_articles")
        )
      )
    ).toEqual(new Set());
  });
});
