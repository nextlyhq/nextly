/**
 * Drizzle `relations()` declarations for the dynamic-collections table —
 * SQLite.
 *
 * Only one cross-feature relation: `creator` → owning user.
 *
 * @module schemas/dynamic-collections/sqlite-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/sqlite";

import { dynamicCollectionsSqlite } from "./sqlite";

export const dynamicCollectionsRelations = relations(
  dynamicCollectionsSqlite,
  ({ one }) => ({
    creator: one(users, {
      fields: [dynamicCollectionsSqlite.createdBy],
      references: [users.id],
    }),
  })
);
