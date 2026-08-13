/**
 * The declared lock table and the DDL that bootstraps it must describe the SAME table.
 *
 * Two things now create `nextly_field_group_lock`, and they run at different moments for different
 * reasons: `getMigrationLockDdl` builds it out-of-band, because a session has to be able to contend
 * for the lock long before anyone runs a migration, and `getCoreSchema` declares it so a reconcile
 * can carry a later change onto installations that already have it.
 *
 * That is two answers to one question, which this repository treats as a defect waiting to happen —
 * and here the drift would be quiet in the worst way. If the declaration and the DDL disagree, every
 * `nextly migrate` proposes a change to a table that is already correct, on every run, forever; and
 * a future column added to one of them would silently not reach databases built by the other.
 *
 * Deleting either is not an option. The bootstrap cannot be dropped (ordering), and the declaration
 * cannot be dropped (reconcilability). So they are pinned against each other instead.
 */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getMigrationLockDdl } from "../../../domains/field-groups/migration/session";
import { fieldGroupLockTables } from "../index";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

/** The dialects a lock is ever created on. */
const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/**
 * The column names the bootstrap statement declares, read out of the statement itself.
 *
 * Parsed rather than restated: a list written here would be a THIRD answer to the same question,
 * and the one most likely to be updated last.
 */
function columnsInDdl(statement: string): string[] {
  const body = /\(([^)]*)\)/.exec(statement)?.[1] ?? "";
  return body
    .split(",")
    .map(part => part.trim().split(/\s+/)[0])
    .filter(name => name.length > 0);
}

describe("the bootstrap DDL and the declared table agree", () => {
  it.each(DIALECTS)("declares the same columns on %s", dialect => {
    const [statement, ...rest] = getMigrationLockDdl(
      dialect === "postgresql" ? "postgresql" : dialect
    );
    // One statement, so a second one appearing later cannot slip past unread.
    expect(rest).toEqual([]);
    expect(statement).toBeDefined();

    // 🔴 Read through Drizzle's own accessor, not `Object.keys`. A table object carries internals
    // alongside its columns (`enableRLS` on pg, among others), and the first version of this test
    // filtered them by name convention — which is a guess about someone else's spelling that goes
    // stale the moment they add another. `getTableColumns` is the structural answer.
    const declared = Object.keys(
      getTableColumns(fieldGroupLockTables(dialect).nextlyFieldGroupLock)
    );

    // Sorted: the order columns appear in a CREATE is not part of the contract.
    expect(columnsInDdl(statement as string).sort()).toEqual(declared.sort());
  });

  it("names the same table the session claims", () => {
    // A positive control on the parser above: it has to actually find columns, or every comparison
    // in this file passes by both sides being empty.
    const [statement] = getMigrationLockDdl("postgresql");
    expect(columnsInDdl(statement as string)).toContain("owner");
    expect(statement).toContain("nextly_field_group_lock");
  });
});
