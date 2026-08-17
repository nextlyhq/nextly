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
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import {
  getMigrationLockDdl,
  getMigrationLockUpgradeDdl,
} from "../../../domains/field-groups/migration/session";
import { nextlyFieldGroupLock as myLock } from "../mysql";
import { nextlyFieldGroupLock as pgLock } from "../postgres";
import { nextlyFieldGroupLock as slLock } from "../sqlite";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

/** Each dialect's declared columns, read through the dialect's own config reader. */
const DECLARED_COLUMNS: Record<
  SupportedDialect,
  () => { name: string; getSQLType: () => string }[]
> = {
  postgresql: () => pgTableConfig(pgLock).columns,
  mysql: () => mysqlTableConfig(myLock).columns,
  sqlite: () => sqliteTableConfig(slLock).columns,
};

/** Each dialect's declared table, normalised to the one thing this compares. */
const DECLARED: Record<SupportedDialect, () => string[]> = {
  postgresql: () => DECLARED_COLUMNS.postgresql().map(c => c.name),
  mysql: () => DECLARED_COLUMNS.mysql().map(c => c.name),
  sqlite: () => DECLARED_COLUMNS.sqlite().map(c => c.name),
};

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

/**
 * The type each column is given in the bootstrap statement, keyed by column name.
 *
 * The trailing key clause belongs to the column's definition rather than to its type, so it is
 * removed before comparing; leaving it in would compare `integer PRIMARY KEY` against `integer`
 * and fail on a statement that is correct.
 */
function typesInDdl(statement: string): Map<string, string> {
  const body = /\(([\s\S]*)\)/.exec(statement)?.[1] ?? "";
  const types = new Map<string, string>();
  for (const part of body.split(",")) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name === undefined || name.length === 0) continue;
    types.set(name, rest.join(" ").replace(/\s+PRIMARY KEY$/i, ""));
  }
  return types;
}

describe("the bootstrap DDL and the declared table agree", () => {
  it.each(DIALECTS)("gives every column its declared type on %s", dialect => {
    const [statement] = getMigrationLockDdl(dialect);
    const inDdl = typesInDdl(statement as string);

    // 🔴 Positive control on the parser: without it, a body that parsed to nothing would make every
    // comparison below vacuous, since a loop over zero declared columns asserts nothing.
    const declared = DECLARED_COLUMNS[dialect]();
    expect(declared.length).toBeGreaterThan(0);
    expect([...inDdl.keys()].sort()).toEqual(declared.map(c => c.name).sort());

    for (const column of declared) {
      expect(inDdl.get(column.name)).toBe(column.getSQLType());
    }
  });

  it.each(DIALECTS)(
    "adds the same expiry column on upgrade as it creates on %s",
    dialect => {
      // An installation that gains `expires_at` by ALTER must end up the shape a fresh install is
      // born with, or the two populations diverge and nothing downstream can tell them apart.
      const created = typesInDdl(getMigrationLockDdl(dialect)[0] as string).get(
        "expires_at"
      );
      const added = /\bexpires_at\s+([\s\S]+)$/.exec(
        getMigrationLockUpgradeDdl(dialect)
      )?.[1];

      expect(created).toBeDefined();
      expect(added).toBe(created);
    }
  );

  it.each(DIALECTS)("declares the same columns on %s", dialect => {
    const [statement, ...rest] = getMigrationLockDdl(
      dialect === "postgresql" ? "postgresql" : dialect
    );
    // One statement, so a second one appearing later cannot slip past unread.
    expect(rest).toEqual([]);
    expect(statement).toBeDefined();

    // 🔴 Read through the dialect's own `getTableConfig`, not `Object.keys`. A table object carries
    // internals alongside its columns (`enableRLS` on pg, among others), and filtering those by
    // name convention is a guess about someone else's spelling that goes stale the moment they add
    // another. The drizzle-v1 gate bars the whole-table column accessor, so this follows the prior
    // art in `schemas/__tests__/activity-log-actor-columns.test.ts` instead.
    const declared = DECLARED[dialect]();

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
