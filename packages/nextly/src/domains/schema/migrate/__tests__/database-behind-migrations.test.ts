/**
 * What the "database lacks what its migrations made" check reads from an applied snapshot: the
 * app's own tables whole, and of a table another owner declares (a plugin's, Nextly's) only the
 * columns the app contributed to it. The snapshot keeps such a table whole, but its other columns
 * are its owner's, whose own history may drop or rename them.
 */
import { describe, expect, it } from "vitest";

import type { TableSpec } from "../../pipeline/diff/types";
import {
  appOwnedTables,
  missingFromDatabase,
} from "../database-behind-migrations";

const column = (name: string) => ({
  name,
  type: "text",
  nullable: true,
  default: undefined,
});

const table = (name: string, columns: string[]): TableSpec =>
  ({ name, columns: columns.map(column) }) as unknown as TableSpec;

const NONE = { indexes: [], foreignKeys: [], checks: [] };

describe("the database-behind check over an applied snapshot", () => {
  const file = {
    snapshot: {
      tables: [
        table("dc_posts", ["id", "title"]),
        // A plugin's table, held whole because the app contributes `app_ref` to it.
        table("forms_entries", ["id", "plugin_column", "app_ref"]),
      ],
    },
    contributions: { forms_entries: { columns: ["app_ref"], ...NONE } },
  };

  it("never names a column of another owner's table that the app did not contribute", () => {
    const applied = [{ migration: "0001_create", ...appOwnedTables(file) }];
    const live = new Map([
      ["dc_posts", new Set(["id", "title"])],
      // The plugin's own history dropped its column: the plugin's ledger and database agree.
      ["forms_entries", new Set(["id", "app_ref"])],
    ]);
    expect(missingFromDatabase(applied, live)).toEqual([]);
  });

  it("names a column the app contributed to another owner's table, and the app's own", () => {
    const applied = [{ migration: "0001_create", ...appOwnedTables(file) }];
    const live = new Map([
      ["dc_posts", new Set(["id"])],
      ["forms_entries", new Set(["id", "plugin_column"])],
    ]);
    expect(missingFromDatabase(applied, live)).toEqual([
      { table: "dc_posts", column: "title", createdBy: "0001_create" },
      { table: "forms_entries", column: "app_ref", createdBy: "0001_create" },
    ]);
  });

  it("never names another owner's table missing whole, which is its owner's to report", () => {
    const applied = [{ migration: "0001_create", ...appOwnedTables(file) }];
    const live = new Map([["dc_posts", new Set(["id", "title"])]]);
    expect(missingFromDatabase(applied, live)).toEqual([]);
  });

  it("names each column the app added to a table Nextly makes again bare, when that table is missing whole", () => {
    const core = {
      snapshot: {
        tables: [
          table("dc_posts", ["id", "title"]),
          // Nextly's own table, held whole because the app contributes to it.
          table("users", ["id", "email", "app_flag", "app_note"]),
        ],
      },
      contributions: { users: { columns: ["app_flag", "app_note"], ...NONE } },
    };
    const applied = [
      {
        migration: "0001_create",
        ...appOwnedTables(core),
        // The core reconcile makes `users` again, without the app's columns.
        remade: new Set(["users"]),
      },
    ];
    const live = new Map([["dc_posts", new Set(["id", "title"])]]);
    expect(missingFromDatabase(applied, live)).toEqual([
      { table: "users", column: "app_flag", createdBy: "0001_create" },
      { table: "users", column: "app_note", createdBy: "0001_create" },
    ]);
  });
});
