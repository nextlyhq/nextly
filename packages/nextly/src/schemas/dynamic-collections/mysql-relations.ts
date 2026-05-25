/**
 * Drizzle `relations()` declarations for the dynamic-collections table —
 * MySQL.
 *
 * Only one cross-feature relation: `creator` → owning user.
 *
 * @module schemas/dynamic-collections/mysql-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/mysql";

import { dynamicCollectionsMysql } from "./mysql";

export const dynamicCollectionsRelations = relations(
  dynamicCollectionsMysql,
  ({ one }) => ({
    creator: one(users, {
      fields: [dynamicCollectionsMysql.createdBy],
      references: [users.id],
    }),
  })
);
