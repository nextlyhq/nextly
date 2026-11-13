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
  recordedPrefixes,
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
    expect(recordedPrefixes("forms", [row({ tableName: "legacy" })]).size).toBe(
      0
    );
  });

  it("reads the prefix up to the first separator, which a prefix cannot hold", () => {
    expect([
      ...recordedPrefixes("forms", [row({ tableName: "forms__a__b" })]),
    ]).toEqual([["forms", ["forms__a__b"]]]);
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
