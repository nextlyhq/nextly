/**
 * Drizzle `relations()` declarations for the user identity tables — SQLite.
 *
 * Separate from `sqlite.ts` for the same reason as `postgres-relations.ts`:
 * keep the table-definition file free of cross-feature imports. Re-exported
 * from `schemas/users/index.ts` alongside the tables.
 *
 * @module schemas/users/sqlite-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { apiKeys } from "../api-keys/sqlite";
import { activityLog } from "../audit/sqlite";
import { refreshTokens } from "../auth-tokens/sqlite";
import { userRoles, userPermissionCache } from "../rbac/sqlite";

import { users, accounts, sessions } from "./sqlite";

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  refreshTokens: many(refreshTokens),
  userRoles: many(userRoles),
  permissionCache: many(userPermissionCache),
  apiKeys: many(apiKeys),
  activityLogs: many(activityLog),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));
