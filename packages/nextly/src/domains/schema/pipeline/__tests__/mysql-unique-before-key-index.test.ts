import { describe, expect, it } from "vitest";

import type { Operation, TableSpec } from "../diff/types";
import {
  keyIndexDropsHeldForUnique,
  uniqueCreatedBeforeKeyIndexDrop,
  withHeldKeyIndexDrops,
} from "../mysql-unique-before-key-index";

const DROP = "DROP INDEX `idx_profiles_person` ON `profiles`;";
const CREATE =
  "CREATE UNIQUE INDEX `uq_profiles_person` ON `profiles` (`person`);";
const OTHER = "ALTER TABLE `profiles` ADD `bio` text;";

/** The profiles as the database holds them: a plain index on `person`, and a key on it or not. */
const profiles = (
  keyed: boolean,
  index: Partial<{ unique: boolean; columns: string[] }> = {}
): Pick<TableSpec, "name" | "indexes" | "foreignKeys">[] => [
  {
    name: "profiles",
    indexes: [
      {
        name: "idx_profiles_person",
        columns: index.columns ?? ["person"],
        unique: index.unique ?? false,
      },
    ],
    foreignKeys: keyed
      ? [
          {
            name: "fk_profiles_person",
            columns: ["person"],
            referencesTable: "people",
            referencesColumns: ["id"],
            onDelete: "set null",
            onUpdate: "no action",
          },
        ]
      : [],
  },
];

describe("a MySQL push's unique index ahead of a key's plain index", () => {
  it("creates the unique index first where a key uses the column, keeping the rest in place", () => {
    expect(
      uniqueCreatedBeforeKeyIndexDrop(
        [OTHER, DROP, "SELECT 1", CREATE],
        "mysql",
        profiles(true)
      )
    ).toEqual([OTHER, CREATE, DROP, "SELECT 1"]);
  });

  it("reads the ALTER TABLE spelling of the drop too", () => {
    const alter = "ALTER TABLE `profiles` DROP INDEX `idx_profiles_person`;";
    expect(
      uniqueCreatedBeforeKeyIndexDrop([alter, CREATE], "mysql", profiles(true))
    ).toEqual([CREATE, alter]);
  });

  it("moves nothing in an index swap on a column no key uses", () => {
    const statements = [OTHER, DROP, CREATE];
    expect(
      uniqueCreatedBeforeKeyIndexDrop(statements, "mysql", profiles(false))
    ).toEqual(statements);
  });

  it("moves nothing where the dropped index is unique, or led by another column", () => {
    const statements = [DROP, CREATE];
    expect(
      uniqueCreatedBeforeKeyIndexDrop(
        statements,
        "mysql",
        profiles(true, { unique: true })
      )
    ).toEqual(statements);
    expect(
      uniqueCreatedBeforeKeyIndexDrop(
        statements,
        "mysql",
        profiles(true, { columns: ["title", "person"] })
      )
    ).toEqual(statements);
  });

  it("moves nothing where the unique index is led by another column", () => {
    const statements = [
      DROP,
      "CREATE UNIQUE INDEX `uq_profiles_title` ON `profiles` (`title`, `person`);",
    ];
    expect(
      uniqueCreatedBeforeKeyIndexDrop(statements, "mysql", profiles(true))
    ).toEqual(statements);
  });

  it("moves nothing on PostgreSQL or SQLite", () => {
    const statements = [DROP, CREATE];
    for (const dialect of ["postgresql", "sqlite"] as const) {
      expect(
        uniqueCreatedBeforeKeyIndexDrop(statements, dialect, profiles(true))
      ).toEqual(statements);
    }
  });
});

describe("a key's plain index dropped after the unique one replacing it", () => {
  const drop: Operation = {
    type: "drop_index",
    tableName: "profiles",
    index: { name: "idx_profiles_person", columns: ["person"], unique: false },
  };
  const add: Operation = {
    type: "add_index",
    tableName: "profiles",
    index: { name: "uq_profiles_person", columns: ["person"], unique: true },
  };

  it("holds the drop on MySQL where a key uses the column and a unique index replaces it", () => {
    expect(
      keyIndexDropsHeldForUnique([drop, add], "mysql", profiles(true))
    ).toEqual([drop]);
  });

  it("holds nothing without a key, without a unique replacement, or on PostgreSQL and SQLite", () => {
    expect(
      keyIndexDropsHeldForUnique([drop, add], "mysql", profiles(false))
    ).toEqual([]);
    expect(keyIndexDropsHeldForUnique([drop], "mysql", profiles(true))).toEqual(
      []
    );
    expect(
      keyIndexDropsHeldForUnique([drop, add], "postgresql", profiles(true))
    ).toEqual([]);
    expect(
      keyIndexDropsHeldForUnique([drop, add], "sqlite", profiles(true))
    ).toEqual([]);
  });

  it("adds a held drop to the batch once, and none the batch already makes", () => {
    const held = keyIndexDropsHeldForUnique(
      [drop, add],
      "mysql",
      profiles(true)
    );
    expect(withHeldKeyIndexDrops([CREATE], held)).toEqual([
      CREATE,
      DROP.replace(/;$/, ""),
    ]);
    expect(withHeldKeyIndexDrops([DROP, CREATE], held)).toEqual([DROP, CREATE]);
  });
});
