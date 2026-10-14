import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { DELETED_PRINCIPALS_TABLE } from "./table-name";

/** As in `./postgres`. */
export const nextlyDeletedPrincipals = sqliteTable(DELETED_PRINCIPALS_TABLE, {
  digest: text("digest").primaryKey(),
  // Unix seconds, as every other timestamp in this dialect's tables.
  deletedAt: integer("deleted_at", { mode: "timestamp" }).notNull(),
});
