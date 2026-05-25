/**
 * Drizzle `relations()` declarations for the API-key tables — PostgreSQL.
 *
 * `apiKeys` participates in two many-to-one relationships: the owning user
 * and the optional role grant. Both targets live in sibling feature dirs,
 * so the relations file stays separate from `api-keys/postgres.ts` to keep
 * the table-definition file free of cross-feature imports.
 *
 * @module schemas/api-keys/postgres-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { roles } from "../rbac/postgres";
import { users } from "../users/postgres";

import { apiKeys } from "./postgres";

/**
 * API-key row → owning user + optional role grant.
 */
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
