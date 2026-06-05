/**
 * Drizzle `relations()` declarations for the API-key tables — MySQL.
 *
 * Mirror of `postgres-relations.ts` for the MySQL dialect.
 *
 * @module schemas/api-keys/mysql-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { roles } from "../rbac/mysql";
import { users } from "../users/mysql";

import { apiKeys } from "./mysql";

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [apiKeys.roleId],
    references: [roles.id],
  }),
}));
