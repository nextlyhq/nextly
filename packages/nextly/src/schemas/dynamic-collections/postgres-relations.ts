/**
 * Drizzle `relations()` declarations for the dynamic-collections table —
 * PostgreSQL.
 *
 * Only one cross-feature relation: `creator` → owning user.
 *
 * @module schemas/dynamic-collections/postgres-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/postgres";

import { dynamicCollectionsPg } from "./postgres";

/**
 * Dynamic-collection row → owning user (the `createdBy` author).
 */
export const dynamicCollectionsRelations = relations(
  dynamicCollectionsPg,
  ({ one }) => ({
    creator: one(users, {
      fields: [dynamicCollectionsPg.createdBy],
      references: [users.id],
    }),
  })
);
