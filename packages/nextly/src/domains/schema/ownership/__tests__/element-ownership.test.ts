/**
 * Ownership at the element level.
 *
 * The load-bearing case: an app-added column on a plugin's table must be
 * INVISIBLE to that plugin's migration reconcile. Without that, the live table
 * has a column the module's snapshot does not, so it matches neither `before`
 * nor `snapshot`, and adoption is refused on a database that is entirely
 * correct.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { TableSpec } from "../../pipeline/diff/types";
import {
  assertMayExtendForeignTable,
  elementKey,
  elementsOwnedBy,
  extendersOf,
  viewForStream,
  type ElementOwner,
} from "../element-ownership";

const table: TableSpec = {
  name: "auth__identities",
  columns: [
    { name: "id", type: "varchar(36)", nullable: false },
    { name: "provider", type: "text", nullable: false },
    { name: "app_note", type: "text", nullable: true },
  ],
  indexes: [
    {
      name: "idx_auth__identities_provider",
      columns: ["provider"],
      unique: false,
    },
    {
      name: "idx_auth__identities_app_note",
      columns: ["app_note"],
      unique: false,
    },
  ],
};

const owners = new Map<string, ElementOwner>([
  [
    elementKey("auth__identities", "column", "app_note"),
    {
      tableName: "auth__identities",
      elementKind: "column",
      elementName: "app_note",
      migratedBy: "app",
    },
  ],
  [
    elementKey("auth__identities", "index", "idx_auth__identities_app_note"),
    {
      tableName: "auth__identities",
      elementKind: "index",
      elementName: "idx_auth__identities_app_note",
      migratedBy: "app",
    },
  ],
]);

describe("viewForStream", () => {
  it("hides another stream's elements from the plugin's reconcile", () => {
    // This is what stops an app-added column making every later plugin
    // migration report drift on a correct database.
    const view = viewForStream(table, "plugin:auth", owners);
    expect(view.columns.map(c => c.name)).toEqual(["id", "provider"]);
    expect(view.indexes?.map(i => i.name)).toEqual([
      "idx_auth__identities_provider",
    ]);
  });

  it("shows the app its own elements", () => {
    const view = viewForStream(table, "app", owners);
    expect(view.columns.map(c => c.name)).toContain("app_note");
  });

  it("keeps elements nobody has claimed", () => {
    // Absence means unclaimed, and a column predating the registry belongs to
    // whoever is looking — removing it would make every stream believe the
    // table was missing a column it has.
    const view = viewForStream(table, "plugin:auth", new Map());
    expect(view.columns).toHaveLength(3);
  });
});

describe("extending a foreign table", () => {
  const base = {
    contributor: "seo",
    ownerPlugin: "auth",
    dependsOn: new Set<string>(),
    optionalDependsOn: new Set<string>(),
    tableName: "auth__identities",
  };

  it("allows a hard dependency", () => {
    expect(() =>
      assertMayExtendForeignTable({ ...base, dependsOn: new Set(["auth"]) })
    ).not.toThrow();
  });

  it("allows an optional dependency", () => {
    // The difference is what happens when the owner is ABSENT: a hard
    // dependency fails, an optional one skips the extension.
    expect(() =>
      assertMayExtendForeignTable({
        ...base,
        optionalDependsOn: new Set(["auth"]),
      })
    ).not.toThrow();
  });

  it("refuses with neither, naming both options", () => {
    try {
      assertMayExtendForeignTable(base);
      throw new Error("expected a refusal");
    } catch (error) {
      const data = (error as NextlyError).publicData as {
        errors?: { message: string }[];
      };
      expect(data.errors?.[0]?.message).toMatch(/optionalDependsOn/);
    }
  });
});

describe("extendersOf", () => {
  const elements: ElementOwner[] = [
    {
      tableName: "auth__identities",
      elementKind: "column",
      elementName: "seo_slug",
      migratedBy: "plugin:seo",
    },
    {
      tableName: "auth__identities",
      elementKind: "table",
      elementName: "auth__identities",
      migratedBy: "plugin:auth",
    },
    {
      tableName: "auth__identities",
      elementKind: "column",
      elementName: "app_note",
      migratedBy: "app",
    },
  ];

  it("names plugins that actually added elements", () => {
    expect(extendersOf("auth", ["auth__identities"], elements)).toEqual([
      "seo",
    ]);
  });

  it("does not count the owner's own table record", () => {
    // Otherwise a plugin would be its own dependent and could never be
    // uninstalled.
    expect(extendersOf("auth", ["auth__identities"], elements)).not.toContain(
      "auth"
    );
  });

  it("is empty when only the app extended it", () => {
    expect(
      extendersOf("auth", ["auth__identities"], [elements[1], elements[2]])
    ).toEqual([]);
  });
});

describe("elementsOwnedBy", () => {
  it("lists what an uninstall must drop, excluding the table record", () => {
    const elements: ElementOwner[] = [
      {
        tableName: "auth__identities",
        elementKind: "column",
        elementName: "app_note",
        migratedBy: "app",
      },
      {
        tableName: "auth__identities",
        elementKind: "table",
        elementName: "auth__identities",
        migratedBy: "app",
      },
    ];
    expect(
      elementsOwnedBy("app", ["auth__identities"], elements).map(
        e => e.elementName
      )
    ).toEqual(["app_note"]);
  });
});
