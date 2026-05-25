/**
 * Drizzle `relations()` declarations for the audit tables — MySQL.
 *
 * Only `activityLog` carries a cross-feature relation (→ `users`).
 *
 * @module schemas/audit/mysql-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/mysql";

import { activityLog } from "./mysql";

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  user: one(users, {
    fields: [activityLog.userId],
    references: [users.id],
  }),
}));
