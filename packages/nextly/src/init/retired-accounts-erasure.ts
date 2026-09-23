/**
 * Erasing a deleted user's rows from the RETIRED `accounts` table.
 *
 * `accounts` is no longer created and nothing reads or writes it, but an
 * upgraded database keeps it until the operator drops it — that is the whole
 * point of retiring rather than dropping (`init/retired-auth-tables`). Its
 * rows hold provider identifiers and stored access, refresh and ID tokens.
 *
 * On PostgreSQL and MySQL the former `accounts.user_id` carried no foreign key
 * with a cascade, so deleting a user does NOT remove them: the credentials of
 * a person whose account is gone would sit in the database indefinitely, and
 * no later run revisits a deletion that has already happened.
 *
 * ## Why a definition here rather than the one that was removed
 *
 * The full definitions were removed deliberately, so nothing creates these
 * tables again. What is needed to ERASE from one is far smaller: the table
 * name and the column to match on. Declaring only that keeps the erasure in
 * Drizzle — parameterised, and quoted correctly per dialect — without giving
 * the schema pipeline anything it could create, push or reconcile.
 *
 * @module init/retired-accounts-erasure
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { pgTable, text } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

/** The retired table this module erases from. */
export const RETIRED_ACCOUNTS_TABLE = "accounts";

/** The column that names the owning user, as every dialect spelled it. */
const OWNER_COLUMN = "user_id";

/**
 * The minimum shape needed to delete one user's rows.
 *
 * Only the matched column is declared. A `DELETE ... WHERE user_id = ?` needs
 * nothing else, and every column left out is one this module cannot
 * accidentally resurrect.
 */
export function retiredAccountsTable(dialect: SupportedDialect) {
  if (dialect === "postgresql") {
    return pgTable(RETIRED_ACCOUNTS_TABLE, {
      userId: text(OWNER_COLUMN).notNull(),
    });
  }
  if (dialect === "mysql") {
    return mysqlTable(RETIRED_ACCOUNTS_TABLE, {
      userId: varchar(OWNER_COLUMN, { length: 255 }).notNull(),
    });
  }
  return sqliteTable(RETIRED_ACCOUNTS_TABLE, {
    userId: sqliteText(OWNER_COLUMN).notNull(),
  });
}
