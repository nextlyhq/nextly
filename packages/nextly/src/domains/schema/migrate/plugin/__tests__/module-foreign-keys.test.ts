/**
 * A module's foreign keys may only reach a table the owner's modules have
 * created by the time the module runs — the chain's own order, judged where
 * the chain is decided: at generation and before a run.
 *
 * The failing shape this guards: a plugin's FIRST module keys to a table its
 * SECOND creates. Nothing in either module's SQL is wrong on its own; the
 * defect is the arrival order, and without this rule it is the database that
 * reports it, naming neither the module nor the key.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../../errors/nextly-error";
import type { TableSpec } from "../../../pipeline/diff/types";
import {
  assertModuleForeignKeysResolve,
  migrationChecksum,
  type PluginMigration,
} from "../plugin-migration";

/** A table with one key over `ref` at `target`'s id. */
const keying = (name: string, target: string): TableSpec => ({
  name,
  columns: [
    { name: "id", type: "varchar(32)", nullable: false },
    { name: "ref", type: "varchar(32)", nullable: false },
  ],
  indexes: [],
  foreignKeys: [
    {
      name: `fk_${name}_ref`,
      columns: ["ref"],
      referencesTable: target,
      referencesColumns: ["id"],
      onDelete: "restrict",
      onUpdate: "restrict",
    },
  ],
});

/** A plain table with no keys. */
const plain = (name: string): TableSpec => ({
  name,
  columns: [{ name: "id", type: "varchar(32)", nullable: false }],
  indexes: [],
  foreignKeys: [],
});

/** A module whose snapshot holds `tables`, carrying no real SQL. */
const module = (name: string, tables: TableSpec[]): PluginMigration => {
  const content = {
    name,
    schemaVersion: 1,
    dialects: {
      postgresql: { up: [], down: [] },
      mysql: { up: [], down: [] },
      sqlite: { up: [], down: [] },
    },
    snapshot: {
      postgresql: { tables },
      mysql: { tables },
      sqlite: { tables },
    },
    before: {
      postgresql: { tables: [] },
      mysql: { tables: [] },
      sqlite: { tables: [] },
    },
  };
  return { ...content, checksum: migrationChecksum(content) };
};

/** The refusal message, or "" when the chain resolves. */
const messageOf = (modules: PluginMigration[]): string => {
  try {
    assertModuleForeignKeysResolve("fx", modules);
    return "";
  } catch (error) {
    if (!(error instanceof NextlyError)) throw error;
    const data = error.publicData as { errors?: { message: string }[] };
    return data.errors?.[0]?.message ?? "";
  }
};

describe("assertModuleForeignKeysResolve", () => {
  it("refuses a first module's key to a table only its second creates, naming both modules and the key", () => {
    const message = messageOf([
      module("001_init", [keying("fx__child", "fx__parents")]),
      module("002_parents", [
        keying("fx__child", "fx__parents"),
        plain("fx__parents"),
      ]),
    ]);
    expect(message).toContain("001_init");
    expect(message).toContain("fk_fx__child_ref");
    expect(message).toContain("fx__parents");
    expect(message).toContain("002_parents");
  });

  it("accepts a key whose target an earlier module created", () => {
    expect(
      messageOf([
        module("001_parents", [plain("fx__parents")]),
        module("002_child", [
          plain("fx__parents"),
          keying("fx__child", "fx__parents"),
        ]),
      ])
    ).toBe("");
  });

  it("accepts a key whose target the same module creates", () => {
    // Same-module order is the renderer's: a table's create precedes a
    // constraint that names it, and the one shape it cannot so order is
    // split into creates then constraint adds.
    expect(
      messageOf([
        module("001_all", [
          keying("fx__child", "fx__parents"),
          plain("fx__parents"),
        ]),
      ])
    ).toBe("");
  });

  it("passes a target no module of the owner names to the reach rules that own it", () => {
    // `users` is core, `other__things` another owner's: arrival order is not
    // their question, and the declaration compile judges their reach.
    expect(
      messageOf([module("001_init", [keying("fx__child", "users")])])
    ).toBe("");
    expect(
      messageOf([module("001_init", [keying("fx__child", "other__things")])])
    ).toBe("");
  });

  it("judges a table a middle module dropped by its arrival again, not by memory", () => {
    // fx__parents exists (001), is dropped (002), and only 004 recreates it.
    // The key in 003 must be refused even though 001 once created it: what a
    // module may key to is what exists when it runs, and from 002 on that is
    // nothing. A set that only ever accumulated would pass the key on 001's
    // memory of the table.
    const message = messageOf([
      module("001_parents", [plain("fx__parents")]),
      module("002_drop", [plain("fx__child")]),
      module("003_key", [keying("fx__child", "fx__parents")]),
      module("004_again", [plain("fx__child"), plain("fx__parents")]),
    ]);
    expect(message).toContain("003_key");
    expect(message).toContain("004_again");
  });

  it("accepts a key to a table that exists when the module runs, even if the module itself drops it after", () => {
    // Existence is judged at the module's start: 001 created the target, so
    // 002 may key to it while also being the module that drops it.
    expect(
      messageOf([
        module("001_parents", [plain("fx__parents")]),
        module("002_key_and_drop", [keying("fx__child", "fx__parents")]),
      ])
    ).toBe("");
  });
});
