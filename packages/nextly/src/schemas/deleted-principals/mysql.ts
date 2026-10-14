import { datetime, mysqlTable, varchar } from "drizzle-orm/mysql-core";

import { DELETED_PRINCIPALS_TABLE } from "./table-name";

/** As in `./postgres`. */
export const nextlyDeletedPrincipals = mysqlTable(DELETED_PRINCIPALS_TABLE, {
  digest: varchar("digest", { length: 64 }).primaryKey(),
  // `datetime`, not `timestamp`, as the audit log's stamps are: a MySQL
  // TIMESTAMP follows the server's explicit_defaults_for_timestamp mode.
  deletedAt: datetime("deleted_at").notNull(),
});
