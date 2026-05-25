/**
 * Drizzle `relations()` declarations for the media tables — MySQL.
 *
 * Mirror of `postgres-relations.ts` for the MySQL dialect.
 *
 * @module schemas/media/mysql-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/mysql";

import { media, mediaFolders } from "./mysql";

export const mediaRelations = relations(media, ({ one }) => ({
  uploader: one(users, {
    fields: [media.uploadedBy],
    references: [users.id],
  }),
}));

export const mediaFoldersRelations = relations(
  mediaFolders,
  ({ one, many }) => ({
    createdByUser: one(users, {
      fields: [mediaFolders.createdBy],
      references: [users.id],
    }),
    parentFolder: one(mediaFolders, {
      fields: [mediaFolders.parentId],
      references: [mediaFolders.id],
      relationName: "subfolders",
    }),
    subfolders: many(mediaFolders, {
      relationName: "subfolders",
    }),
    mediaFiles: many(media),
  })
);
