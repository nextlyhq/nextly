/**
 * Media tables — MySQL.
 *
 * Tables: media, mediaFolders, imageSizes.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` blocks live in `../_dialect-bundles/mysql.relations.ts` and are
 * re-exported at the bottom of this file. See `./postgres.ts` for the
 * rationale.
 *
 * @module schemas/media/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { sql } from "drizzle-orm";
import {
  mysqlTable,
  int,
  varchar,
  datetime,
  json,
  index,
  uniqueIndex,
  text,
  boolean,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";

import { users } from "../users/mysql";

/**
 * Media table for storing uploaded files and images
 *
 * Supports various storage backends (Vercel Blob, S3, R2, local filesystem)
 * Stores file metadata in database, actual files in configured storage
 *
 * MySQL variant - uses JSON instead of JSONB for tags
 */
export const media = mysqlTable(
  "media",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // File identification
    filename: varchar("filename", { length: 255 }).notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    size: int("size").notNull(),

    // Image/video dimensions
    width: int("width"),
    height: int("height"),
    duration: int("duration"),

    // Storage URLs
    url: text("url").notNull(),
    thumbnailUrl: text("thumbnail_url"),

    // Crop point for smart image cropping (percentage from top-left, 0-100)
    focalX: int("focal_x"),
    focalY: int("focal_y"),

    // Generated image size variants (JSON with size name → metadata)
    sizes: json("sizes"),

    // Metadata
    altText: text("alt_text"),
    caption: text("caption"),
    tags: json("tags"), // MySQL uses JSON type for arrays

    // Folder organization (null for root/unorganized files)
    folderId: varchar("folder_id", { length: 255 }).references(
      // The self-referencing FK requires an explicit return type to
      // break TS's circular inference; AnyMySqlColumn matches what
      // Drizzle's references() callback expects without the bare any.
      (): AnyMySqlColumn => mediaFolders.id,
      { onDelete: "set null" }
    ),

    // Ownership and timestamps
    // Nullable: CLI seeds, data imports, and other system-context uploads
    // may not have a user to attribute the upload to.
    uploadedBy: varchar("uploaded_by", { length: 255 }).references(
      () => users.id,
      { onDelete: "cascade" }
    ),
    uploadedAt: datetime("uploaded_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  t => [
    index("media_uploaded_by_idx").on(t.uploadedBy),
    index("media_mime_type_idx").on(t.mimeType),
    index("media_uploaded_at_idx").on(t.uploadedAt),
    index("media_folder_id_idx").on(t.folderId),
  ]
);

/**
 * Media Folders table for organizing media files (MySQL)
 */
export const mediaFolders = mysqlTable(
  "media_folders",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Folder information
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    // Hierarchy
    parentId: varchar("parent_id", { length: 255 }).references(
      // The self-referencing FK requires an explicit return type to
      // break TS's circular inference; AnyMySqlColumn matches what
      // Drizzle's references() callback expects without the bare any.
      (): AnyMySqlColumn => mediaFolders.id,
      { onDelete: "cascade" }
    ),

    // Ownership and timestamps
    createdBy: varchar("created_by", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  t => [
    index("media_folders_parent_id_idx").on(t.parentId),
    index("media_folders_created_by_idx").on(t.createdBy),
    index("media_folders_created_at_idx").on(t.createdAt),
  ]
);

/**
 * Image Sizes table for named image size configurations (MySQL).
 * See postgres.ts for detailed documentation.
 */
export const imageSizes = mysqlTable(
  "image_sizes",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    name: varchar("name", { length: 50 }).notNull(),
    width: int("width"),
    height: int("height"),
    fit: varchar("fit", { length: 20 }).notNull().default("inside"),
    quality: int("quality").notNull().default(80),
    format: varchar("format", { length: 10 }).notNull().default("auto"),
    isDefault: boolean("is_default").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: datetime("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [uniqueIndex("image_sizes_name_unique").on(t.name)]
);
