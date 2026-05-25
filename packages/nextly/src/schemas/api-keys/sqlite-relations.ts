/**
 * Drizzle `relations()` declarations for the API-key tables — SQLite.
 *
 * Mirror of `postgres-relations.ts` for the SQLite dialect.
 *
 * @module schemas/api-keys/sqlite-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { roles } from "../rbac/sqlite";
import { users } from "../users/sqlite";

import { apiKeys } from "./sqlite";

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
