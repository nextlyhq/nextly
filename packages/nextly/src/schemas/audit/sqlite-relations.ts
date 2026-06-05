/**
 * Drizzle `relations()` declarations for the audit tables — SQLite.
 *
 * Only `activityLog` carries a cross-feature relation (→ `users`).
 *
 * @module schemas/audit/sqlite-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/sqlite";

import { activityLog } from "./sqlite";

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  user: one(users, {
    fields: [activityLog.userId],
    references: [users.id],
  }),
}));
