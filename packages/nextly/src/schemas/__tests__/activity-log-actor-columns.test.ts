/**
 * The activity log's actor columns, checked on every dialect at once.
 *
 * The behavioural proof that entries survive their author runs against one
 * live database, because that is where foreign-key enforcement actually lives.
 * These assertions cover the other two: the three dialect files are edited by
 * hand and independently, so a cascade re-added to just one of them would
 * restore the data-loss defect on that dialect alone and pass every test the
 * live suite runs.
 */

import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { activityLog as mysqlActivityLog } from "../audit/mysql";
import { activityLog as pgActivityLog } from "../audit/postgres";
import { activityLog as sqliteActivityLog } from "../audit/sqlite";

/** What each dialect's table declares, normalised to one shape. */
const DIALECTS = [
  {
    name: "postgres",
    config: () => {
      const c = pgTableConfig(pgActivityLog);
      return { columns: c.columns, foreignKeys: c.foreignKeys };
    },
  },
  {
    name: "mysql",
    config: () => {
      const c = mysqlTableConfig(mysqlActivityLog);
      return { columns: c.columns, foreignKeys: c.foreignKeys };
    },
  },
  {
    name: "sqlite",
    config: () => {
      const c = sqliteTableConfig(sqliteActivityLog);
      return { columns: c.columns, foreignKeys: c.foreignKeys };
    },
  },
] as const;

describe.each(DIALECTS)("activity_log on $name", ({ config }) => {
  it("declares no foreign key at all", () => {
    // A cascading key deletes the trail with the account. A restricting one
    // makes deleting an account that ever acted fail outright. Neither is
    // acceptable, so the column carries no key and the identity on the row is
    // erased in place instead.
    expect(config().foreignKeys).toHaveLength(0);
  });

  it("keeps the actor reference required and the identity erasable", () => {
    const columns = config().columns;
    const byName = new Map(columns.map(column => [column.name, column]));

    // The opaque reference has to stay, or two deleted actors become
    // indistinguishable and the trail stops being attributable.
    expect(byName.get("user_id")?.notNull).toBe(true);

    // Nullable is what makes erasure possible without deleting the row.
    expect(byName.get("user_name")?.notNull).toBe(false);
    expect(byName.get("user_email")?.notNull).toBe(false);

    // The marker that distinguishes an erased row from one that never carried
    // a name, and records when the erasure happened.
    expect(byName.has("actor_deleted_at")).toBe(true);
    expect(byName.get("actor_deleted_at")?.notNull).toBe(false);
  });
});
