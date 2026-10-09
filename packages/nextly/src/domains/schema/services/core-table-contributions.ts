/**
 * An extendable core table's Drizzle definition, with the elements schema
 * hooks contributed to it that the database already holds.
 *
 * The core reconcile hands drizzle-kit Nextly's own core tables as the state
 * to reach. A contributed column, index or check on one of them is on the
 * live table and not in that definition, so the kit plans its removal — a
 * DROP on PostgreSQL and MySQL, and on SQLite a table rebuild that copies only
 * the columns the definition names, losing the contributed column's values.
 * Built into the definition, the element is part of the target: nothing is
 * planned against it, and a rebuild copies it like any other column.
 *
 * Only what is already LIVE is built in. An element not yet migrated is still
 * the app's migration stream's to add; adding it here would create it outside
 * that stream.
 *
 * The table is built with the dialect's own table function, from the same
 * column and index factories the static core table is built from — so it is
 * that table, plus the contributions, and nothing about it is assembled by
 * hand.
 *
 * @module domains/schema/services/core-table-contributions
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import {
  check as mysqlCheck,
  index as mysqlIndex,
  mysqlTable,
  uniqueIndex as mysqlUniqueIndex,
} from "drizzle-orm/mysql-core";
import {
  check as pgCheck,
  index as pgIndex,
  pgTable,
  uniqueIndex as pgUniqueIndex,
} from "drizzle-orm/pg-core";
import {
  check as sqliteCheck,
  index as sqliteIndex,
  sqliteTable,
  uniqueIndex as sqliteUniqueIndex,
} from "drizzle-orm/sqlite-core";

import * as auditMysql from "../../../schemas/audit/mysql";
import * as auditPg from "../../../schemas/audit/postgres";
import * as auditSqlite from "../../../schemas/audit/sqlite";
import * as jobsMysql from "../../../schemas/jobs/mysql";
import * as jobsPg from "../../../schemas/jobs/postgres";
import * as jobsSqlite from "../../../schemas/jobs/sqlite";
import * as mediaMysql from "../../../schemas/media/mysql";
import * as mediaPg from "../../../schemas/media/postgres";
import * as mediaSqlite from "../../../schemas/media/sqlite";
import * as usersMysql from "../../../schemas/users/mysql";
import * as usersPg from "../../../schemas/users/postgres";
import * as usersSqlite from "../../../schemas/users/sqlite";
import type { ExtensionColumn } from "../extension/types";
import type { TableSpec } from "../pipeline/diff/types";

import { addContributedDrizzleColumns } from "./runtime-schema-generator";

/**
 * One core table's factories. Typed loosely at this boundary: the table built
 * here carries columns known only at run time, so the static column types the
 * factories are written with cannot describe it.
 */
interface CoreTableFactories {
  columns: () => Record<string, unknown>;
  extraConfig: (table: never) => readonly unknown[];
}

/**
 * The factories of every core table a hook may extend, per dialect, by SQL
 * name. The set is `EXTENDABLE_CORE_TABLES`; a test holds the two equal.
 */
export const EXTENDABLE_CORE_TABLE_FACTORIES: Readonly<
  Record<SupportedDialect, Readonly<Record<string, CoreTableFactories>>>
> = {
  postgresql: {
    users: {
      columns: usersPg.usersColumns,
      extraConfig: usersPg.usersExtraConfig,
    },
    media: {
      columns: mediaPg.mediaColumns,
      extraConfig: mediaPg.mediaExtraConfig,
    },
    nextly_jobs: {
      columns: jobsPg.nextlyJobsPgColumns,
      extraConfig: jobsPg.nextlyJobsPgExtraConfig,
    },
    audit_log: {
      columns: auditPg.auditLogColumns,
      extraConfig: auditPg.auditLogExtraConfig,
    },
    activity_log: {
      columns: auditPg.activityLogColumns,
      extraConfig: auditPg.activityLogExtraConfig,
    },
  },
  mysql: {
    users: {
      columns: usersMysql.usersColumns,
      extraConfig: usersMysql.usersExtraConfig,
    },
    media: {
      columns: mediaMysql.mediaColumns,
      extraConfig: mediaMysql.mediaExtraConfig,
    },
    nextly_jobs: {
      columns: jobsMysql.nextlyJobsMysqlColumns,
      extraConfig: jobsMysql.nextlyJobsMysqlExtraConfig,
    },
    audit_log: {
      columns: auditMysql.auditLogColumns,
      extraConfig: auditMysql.auditLogExtraConfig,
    },
    activity_log: {
      columns: auditMysql.activityLogColumns,
      extraConfig: auditMysql.activityLogExtraConfig,
    },
  },
  sqlite: {
    users: {
      columns: usersSqlite.usersColumns,
      extraConfig: usersSqlite.usersExtraConfig,
    },
    media: {
      columns: mediaSqlite.mediaColumns,
      extraConfig: mediaSqlite.mediaExtraConfig,
    },
    nextly_jobs: {
      columns: jobsSqlite.nextlyJobsSqliteColumns,
      extraConfig: jobsSqlite.nextlyJobsSqliteExtraConfig,
    },
    audit_log: {
      columns: auditSqlite.auditLogColumns,
      extraConfig: auditSqlite.auditLogExtraConfig,
    },
    activity_log: {
      columns: auditSqlite.activityLogColumns,
      extraConfig: auditSqlite.activityLogExtraConfig,
    },
  },
};

/** A column in a table's extra-config argument, as far as naming it goes. */
interface NamedColumn {
  name: string;
}

/**
 * The core table `name`, built afresh with `live` — the contributed columns,
 * indexes and checks the database holds on it — added to what Nextly
 * declares. `undefined` for a table no hook may extend.
 *
 * The contributed columns are built through `addContributedDrizzleColumns`,
 * the builder every other runtime table takes a contribution through, so the
 * type and default the kit compares are the ones the migration created.
 */
export function coreTableWithLiveContributions(
  name: string,
  live: TableSpec,
  contributed: readonly ExtensionColumn[],
  dialect: SupportedDialect
): unknown {
  const factories = EXTENDABLE_CORE_TABLE_FACTORIES[dialect][name];
  if (factories === undefined) return undefined;
  const liveColumns = new Set(live.columns.map(column => column.name));

  const columns = factories.columns();
  addContributedDrizzleColumns(
    columns,
    contributed.filter(column => liveColumns.has(column.name)),
    dialect
  );

  const extraConfig = (table: Record<string, unknown>): unknown[] => {
    const byName = (column: string): unknown =>
      Object.values(table).find(
        candidate => (candidate as NamedColumn).name === column
      );
    return [
      ...factories.extraConfig(table as never),
      ...(live.indexes ?? []).map(index =>
        indexBuilder(dialect, index.name, index.unique).on(
          ...(index.columns.map(byName) as [never, ...never[]])
        )
      ),
      ...(live.checks ?? []).map(entry =>
        checkBuilder(dialect, entry.name, entry.sql)
      ),
    ];
  };

  switch (dialect) {
    case "postgresql":
      return pgTable(name, columns as never, extraConfig as never);
    case "mysql":
      return mysqlTable(name, columns as never, extraConfig as never);
    case "sqlite":
      return sqliteTable(name, columns as never, extraConfig as never);
  }
}

function indexBuilder(
  dialect: SupportedDialect,
  name: string,
  unique: boolean
): { on: (...columns: [never, ...never[]]) => unknown } {
  switch (dialect) {
    case "postgresql":
      return (unique ? pgUniqueIndex : pgIndex)(name);
    case "mysql":
      return (unique ? mysqlUniqueIndex : mysqlIndex)(name);
    case "sqlite":
      return (unique ? sqliteUniqueIndex : sqliteIndex)(name);
  }
}

function checkBuilder(
  dialect: SupportedDialect,
  name: string,
  expression: string
): unknown {
  switch (dialect) {
    case "postgresql":
      return pgCheck(name, sql.raw(expression));
    case "mysql":
      return mysqlCheck(name, sql.raw(expression));
    case "sqlite":
      return sqliteCheck(name, sql.raw(expression));
  }
}
