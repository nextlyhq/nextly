/**
 * Drizzle `relations()` declarations for the user identity tables — PostgreSQL.
 *
 * Why this file is separate from `postgres.ts`:
 *
 * - The relations cross feature boundaries (users → accounts, sessions,
 *   refreshTokens, userRoles, userPermissionCache, apiKeys, activityLog).
 *   Keeping them out of the table-definition file keeps `users/postgres.ts`
 *   free of imports from sibling features and avoids triggering eager-load
 *   chains during schema introspection.
 *
 * - Drizzle's `relations(table, cb)` evaluates `cb` lazily when query plans
 *   are built, so the cross-feature imports here are safe even when sibling
 *   feature files import back from `users/postgres.ts` (the `users` table is
 *   already exported by then).
 *
 * Re-exported from `schemas/users/index.ts` alongside the tables.
 *
 * @module schemas/users/postgres-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { apiKeys } from "../api-keys/postgres";
import { activityLog } from "../audit/postgres";
import { refreshTokens } from "../auth-tokens/postgres";
import { userRoles, userPermissionCache } from "../rbac/postgres";

import { users, accounts, sessions } from "./postgres";

/**
 * User aggregates: every association rooted at the `users` table.
 *
 * `permissionCache` references the `userPermissionCache` denormalized table
 * (Plan A Task 7) which is keyed per-user and powers the auth fast path.
 */
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  refreshTokens: many(refreshTokens),
  userRoles: many(userRoles),
  permissionCache: many(userPermissionCache),
  apiKeys: many(apiKeys),
  activityLogs: many(activityLog),
}));

/**
 * Auth.js account row → owning user.
 */
export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

/**
 * Session row → owning user.
 */
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));
