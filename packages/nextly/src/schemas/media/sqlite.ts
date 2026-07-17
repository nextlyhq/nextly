/**
 * Media tables — SQLite.
 *
 * Tables: media, mediaFolders, imageSizes.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` blocks live in `../_dialect-bundles/sqlite.relations.ts` and are
 * re-exported at the bottom of this file. See `./postgres.ts` for the
 * rationale.
 *
 * @module schemas/media/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "../users/sqlite";

/**
 * Media table for storing uploaded files and images
 *
 * Supports various storage backends (Vercel Blob, S3, R2, local filesystem)
 * Stores file metadata in database, actual files in configured storage
 *
 * SQLite variant - uses TEXT for timestamps and JSON as text
 */
export const media = sqliteTable(
  "media",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // File identification
    filename: text("filename").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),

    // Image/video dimensions
    width: integer("width"),
    height: integer("height"),
    duration: integer("duration"),

    // Storage URLs
    url: text("url").notNull(),
    thumbnailUrl: text("thumbnail_url"),

    // Crop point for smart image cropping (percentage from top-left, 0-100)
    focalX: integer("focal_x"),
    focalY: integer("focal_y"),

    // Generated image size variants (stored as JSON text)
    sizes: text("sizes"),

    // Metadata
    altText: text("alt_text"),
    caption: text("caption"),
    tags: text("tags"), // SQLite stores JSON as TEXT

    // Folder organization (null for root/unorganized files)
    // Note: FK reference uses arrow function for forward reference since mediaFolders is defined later
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    folderId: text("folder_id").references((): any => mediaFolders.id, {
      onDelete: "set null",
    }),

    // Ownership and timestamps
    // Nullable: CLI seeds, data imports, and other system-context uploads
    // may not have a user to attribute the upload to.
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "cascade",
    }),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("media_uploaded_by_idx").on(t.uploadedBy),
    index("media_mime_type_idx").on(t.mimeType),
    index("media_uploaded_at_idx").on(t.uploadedAt),
    index("media_folder_id_idx").on(t.folderId),
  ]
);

/**
 * Media Folders table for organizing media files (SQLite)
 *
 * Supports nested folder hierarchy for better media organization.
 * Folders can contain subfolders and media files.
 */
export const mediaFolders = sqliteTable(
  "media_folders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Folder information
    name: text("name").notNull(),
    description: text("description"),

    // Hierarchy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parentId: text("parent_id").references((): any => mediaFolders.id, {
      onDelete: "cascade",
    }), // Null for root folders

    // Ownership and timestamps
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("media_folders_parent_id_idx").on(t.parentId),
    index("media_folders_created_by_idx").on(t.createdBy),
    index("media_folders_created_at_idx").on(t.createdAt),
  ]
);

/**
 * Image Sizes table for named image size configurations (SQLite).
 * See postgres.ts for detailed documentation.
 */
export const imageSizes = sqliteTable(
  "image_sizes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    name: text("name").notNull(),
    width: integer("width"),
    height: integer("height"),
    fit: text("fit").notNull().default("inside"),
    quality: integer("quality").notNull().default(80),
    format: text("format").notNull().default("auto"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [uniqueIndex("image_sizes_name_unique").on(t.name)]
);
