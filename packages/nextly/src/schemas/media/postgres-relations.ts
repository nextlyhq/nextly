/**
 * Drizzle `relations()` declarations for the media tables — PostgreSQL.
 *
 * - `mediaRelations`: media file → uploader.
 * - `mediaFoldersRelations`: folder → creator, self-join (parent/subfolders),
 *   contained media files.
 *
 * Kept separate from `media/postgres.ts` so the table file is free of
 * cross-feature imports (`users`).
 *
 * @module schemas/media/postgres-relations
 * @since v0.0.3-alpha (Plan A — schemas consolidation, Task 17)
 */

import { relations } from "drizzle-orm";

import { users } from "../users/postgres";

import { media, mediaFolders } from "./postgres";

/**
 * Media file → uploader user.
 */
export const mediaRelations = relations(media, ({ one }) => ({
  uploader: one(users, {
    fields: [media.uploadedBy],
    references: [users.id],
  }),
}));

/**
 * Media folder aggregate.
 *
 * `parentFolder` / `subfolders` form a self-join expressed via the shared
 * `subfolders` relationName so Drizzle wires both directions to the same
 * edge.
 */
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
