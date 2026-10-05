/**
 * A SQLite timestamp column the application stamps: an integer in timestamp
 * mode, not null, set to the current time on insert. SQLite has no timestamp
 * default Drizzle reads back as a Date, so the value comes from here.
 *
 * @module schemas/_internal/sqlite-timestamp
 */
import { integer } from "drizzle-orm/sqlite-core";

export function sqliteTimestamp(name: string) {
  return integer(name, { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());
}
