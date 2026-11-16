import { describe, expect, it, vi } from "vitest";

import type { NextlySchemaSnapshot, Operation } from "../diff/types";
import { withoutUniquesAlreadyEnforced } from "../live-uniques";

/** The live `profiles` table's unique columns, as SQLite's catalog reports them: column → index. */
const enforced = new Map<string, string | null>();
vi.mock("../live-table-facts", () => ({
  readUniqueColumns: async () => enforced,
}));

const live: NextlySchemaSnapshot = {
  tables: [{ name: "profiles", columns: [], indexes: [], foreignKeys: [] }],
} as unknown as NextlySchemaSnapshot;

const add = (name: string, where?: string): Operation => ({
  type: "add_index",
  tableName: "profiles",
  index: {
    name,
    columns: ["person"],
    unique: true,
    ...(where ? { where } : {}),
  },
});
const drop = (name: string): Operation => ({
  type: "drop_index",
  tableName: "profiles",
  index: { name, columns: ["person"], unique: true },
});

const plan = (ops: Operation[]) =>
  withoutUniquesAlreadyEnforced(ops, { db: {}, dialect: "sqlite", live });

describe("a SQLite unique index add over a column the live table already keeps unique", () => {
  it("is left out where an inline constraint enforces the column", async () => {
    enforced.clear();
    enforced.set("person", null);
    expect(await plan([add("uq_profiles_person")])).toEqual([]);
  });

  it("is left out where a named unique index the plan keeps enforces the column", async () => {
    enforced.clear();
    enforced.set("person", "uq_profiles_person_old");
    expect(await plan([add("uq_profiles_person")])).toEqual([]);
  });

  it("is kept where the plan drops the index enforcing the column, so the column stays unique", async () => {
    enforced.clear();
    enforced.set("person", "uq_profiles_person");
    const ops = [
      drop("uq_profiles_person"),
      add("uq_profiles_person_live", "deleted_at IS NULL"),
    ];
    expect(await plan(ops)).toEqual(ops);
  });
});
