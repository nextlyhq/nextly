/**
 * Drizzle `relations()` declarations for the auth-token tables — PostgreSQL.
 *
 * Only `refreshTokens` carries a cross-feature relation (→ `users`); the
 * other token tables are correlation-only (identifier + hash) and have no
 * Drizzle relations.
 *
 * @module schemas/auth-tokens/postgres-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/postgres";

import { refreshTokens } from "./postgres";

/**
 * Refresh-token row → owning user.
 */
export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));
