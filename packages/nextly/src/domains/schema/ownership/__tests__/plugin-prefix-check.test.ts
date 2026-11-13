/**
 * A plugin's prefix is fixed once its tables exist: a declared prefix that
 * differs from the one its recorded tables were created under is refused,
 * naming both.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { OwnerRecord } from "../owner-registry";
import {
  assertPluginPrefixesKept,
  assertRecordedPluginPrefixesKept,
  tablesOutsidePrefix,
} from "../plugin-prefix-check";

const row = (over: Partial<OwnerRecord>): OwnerRecord => ({
  tableName: "forms__submissions",
  ownerKind: "plugin",
  ownerId: "forms",
  migratedBy: "plugin:forms",
  ownerVersion: "1.0.0",
  schemaVersion: 1,
  state: "active",
  ...over,
});

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) return error.publicMessage;
    throw error;
  }
  return "not refused";
}

describe("assertPluginPrefixesKept", () => {
  const owners = [
    row({}),
    row({ tableName: "forms__fields" }),
    // Another plugin's table, and an element the plugin added elsewhere.
    row({ tableName: "seo__meta", ownerId: "seo", migratedBy: "plugin:seo" }),
    row({
      tableName: "dc_posts",
      elementKind: "column",
      elementName: "form_id",
    }),
  ];

  it("refuses a changed prefix, naming both prefixes and the tables", () => {
    expect(
      refusal(() =>
        assertPluginPrefixesKept({
          prefixes: new Map([["forms", "fb"]]),
          owners,
        })
      )
    ).toBe(
      'The plugin "forms" now has the schema prefix "fb", but its tables were created under "forms" (forms__submissions, forms__fields). ' +
        'A plugin\'s prefix is fixed once its tables exist, since the rows cannot move to new names. Declare contributes.schema.prefix: "forms" to keep its tables.'
    );
  });

  it("control: passes the prefix the tables were created under", () => {
    expect(
      refusal(() =>
        assertPluginPrefixesKept({
          prefixes: new Map([
            ["forms", "forms"],
            ["seo", "seo"],
          ]),
          owners,
        })
      )
    ).toBe("not refused");
  });

  it("refuses for a kept (orphaned) install, whose tables are still there", () => {
    expect(
      refusal(() =>
        assertPluginPrefixesKept({
          prefixes: new Map([["forms", "fb"]]),
          owners: [row({ state: "orphaned" })],
        })
      )
    ).toMatch(/created under "forms"/);
  });

  it("passes a reinstall under a new prefix once a full uninstall dropped the tables", () => {
    expect(
      refusal(() =>
        assertPluginPrefixesKept({
          prefixes: new Map([["forms", "fb"]]),
          owners: [row({ state: "uninstalled" })],
        })
      )
    ).toBe("not refused");
  });

  it("passes a plugin with no recorded tables, and reads none from a name without the separator", () => {
    expect(
      refusal(() =>
        assertPluginPrefixesKept({
          prefixes: new Map([["forms", "fb"]]),
          owners: [row({ tableName: "legacy_submissions" })],
        })
      )
    ).toBe("not refused");
  });

  it("passes an unchanged prefix that ends in an underscore, and refuses its change", () => {
    // `pa_` names its table `pa___ledger`: the separator is the last two of
    // the three underscores.
    const owners = [row({ tableName: "pa___ledger" })];
    expect(
      refusal(() =>
        assertPluginPrefixesKept({
          prefixes: new Map([["forms", "pa_"]]),
          owners,
        })
      )
    ).toBe("not refused");
    expect(
      refusal(() =>
        assertPluginPrefixesKept({
          prefixes: new Map([["forms", "pb_"]]),
          owners,
        })
      )
    ).toMatch(
      /now has the schema prefix "pb_", but its tables were created under "pa_" \(pa___ledger\)/
    );
  });

  it("passes an unchanged prefix whose recorded table's authored name starts with an underscore", () => {
    // `pa` + `_ledger` is also `pa___ledger`, and the row stays after a
    // later module retires the table: the prefix could have named it.
    expect(
      refusal(() =>
        assertPluginPrefixesKept({
          prefixes: new Map([["forms", "pa"]]),
          owners: [row({ tableName: "pa___ledger" })],
        })
      )
    ).toBe("not refused");
  });

  it("judges a table by whether the prefix could have named it, separator included", () => {
    expect(
      tablesOutsidePrefix("forms", "forms", [
        row({ tableName: "forms__a__b" }),
        // `forms_x` is another prefix, not `forms` with a table `x...`.
        row({ tableName: "forms_x__t" }),
      ])
    ).toEqual(["forms_x__t"]);
  });
});

describe("assertRecordedPluginPrefixesKept", () => {
  it("reads nothing where the owner registry does not exist yet", async () => {
    await expect(
      assertRecordedPluginPrefixesKept({
        prefixes: new Map([["forms", "fb"]]),
        readOwners: () => Promise.reject(new Error("no such table")),
        registryExists: () => Promise.resolve(false),
      })
    ).resolves.toBeUndefined();
  });

  it("lets a failed read of a registry that exists throw, rather than read it as empty", async () => {
    await expect(
      assertRecordedPluginPrefixesKept({
        prefixes: new Map([["forms", "fb"]]),
        readOwners: () => Promise.reject(new Error("connection reset")),
        registryExists: () => Promise.resolve(true),
      })
    ).rejects.toThrow("connection reset");
  });

  it("refuses from the rows it reads", async () => {
    await expect(
      assertRecordedPluginPrefixesKept({
        prefixes: new Map([["forms", "fb"]]),
        readOwners: () => Promise.resolve([row({})]),
        registryExists: () => Promise.resolve(true),
      })
    ).rejects.toThrow(/created under "forms"/);
  });
});
