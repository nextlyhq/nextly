/**
 * Drizzle `relations()` declarations for the audit tables — PostgreSQL.
 *
 * Only `activityLog` carries a cross-feature relation (→ `users`).
 * `auditLog` is append-only telemetry with no Drizzle-managed relations.
 *
 * @module schemas/audit/postgres-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/postgres";

import { activityLog } from "./postgres";

/**
 * Activity-log row → actor user.
 */
export const activityLogRelations = relations(activityLog, ({ one }) => ({
  user: one(users, {
    fields: [activityLog.userId],
    references: [users.id],
  }),
}));
