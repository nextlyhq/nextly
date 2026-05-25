/**
 * Media tables — PostgreSQL.
 *
 * Tables: media, mediaFolders, imageSizes.
 * Moved verbatim from packages/nextly/src/database/schema/postgres.ts as part
 * of Plan A schemas consolidation. No behavior change.
 *
 * Note: cross-table `relations()` blocks (mediaRelations, mediaFoldersRelations)
 * remain in database/schema/postgres.ts during Plan A — they reference tables
 * that move in later tasks. Relations consolidate in Task 17 once
 * database/schema/ is removed.
 *
 * @module schemas/media/postgres
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  boolean,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { users } from "../users/postgres";

/**
 * Media table for storing uploaded files and images
 *
 * Supports various storage backends (Vercel Blob, S3, R2, local filesystem)
 * Stores file metadata in database, actual files in configured storage
 *
 * @example
 * const media = await db.insert(media).values({
 *   filename: 'abc123.png',
 *   originalFilename: 'profile-photo.png',
 *   mimeType: 'image/png',
 *   size: 102400,
 *   width: 1920,
 *   height: 1080,
 *   url: 'https://blob.vercel-storage.com/abc123.png',
 *   uploadedBy: userId,
 * });
 */
export const media = pgTable(
  "media",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // File identification
    filename: varchar("filename", { length: 255 }).notNull(), // Stored filename (UUID-based or storage-generated)
    originalFilename: varchar("original_filename", { length: 255 }).notNull(), // User's original filename
    mimeType: varchar("mime_type", { length: 100 }).notNull(), // "image/png", "video/mp4", "application/pdf"
    size: integer("size").notNull(), // File size in bytes

    // Image/video dimensions (null for non-media files)
    width: integer("width"),
    height: integer("height"),
    duration: integer("duration"), // Video duration in seconds

    // Storage URLs
    url: text("url").notNull(), // Public URL to access the file
    thumbnailUrl: text("thumbnail_url"), // Optimized thumbnail URL (300x300)

    // Crop point for smart image cropping (percentage from top-left, 0-100)
    focalX: integer("focal_x"), // Horizontal position (0=left, 100=right)
    focalY: integer("focal_y"), // Vertical position (0=top, 100=bottom)

    // Generated image size variants (JSONB with size name → metadata)
    sizes: jsonb("sizes"),

    // Metadata for accessibility and searchability
    altText: text("alt_text"), // Alt text for images (accessibility)
    caption: text("caption"), // Optional caption/description
    tags: text("tags").array(), // Array of tags for organization and search

    // Folder organization (null for root/unorganized files).
    // Self-reference uses an explicit return type to break TS's
    // circular inference; AnyPgColumn matches Drizzle's references()
    // callback contract without the bare `any`.
    folderId: text("folder_id").references((): AnyPgColumn => mediaFolders.id, {
      onDelete: "set null",
    }),

    // Ownership and timestamps
    // Nullable: CLI seeds, data imports, and other system-context uploads
    // may not have a user to attribute the upload to.
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "cascade",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    // Performance indexes for common queries
    index("media_uploaded_by_idx").on(t.uploadedBy), // Filter by uploader
    index("media_mime_type_idx").on(t.mimeType), // Filter by file type (image/*, video/*, etc.)
    index("media_uploaded_at_idx").on(t.uploadedAt), // Sort by upload date
    index("media_tags_idx").on(t.tags), // Search by tags
    index("media_folder_id_idx").on(t.folderId), // Filter by folder
  ]
);

/**
 * Media Folders table for organizing media files
 *
 * Supports nested folder hierarchy for better media organization.
 * Folders can contain subfolders and media files.
 *
 * @example
 * ```typescript
 * // Create a folder
 * await db.insert(mediaFolders).values({
 *   name: 'Product Images',
 *   description: 'All product photos',
 *   createdBy: userId,
 * });
 *
 * // Create a subfolder
 * await db.insert(mediaFolders).values({
 *   name: 'Electronics',
 *   parentId: productImagesId,
 *   createdBy: userId,
 * });
 * ```
 */
export const mediaFolders = pgTable(
  "media_folders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Folder information
    name: varchar("name", { length: 255 }).notNull(), // Folder name
    description: text("description"), // Optional description

    // Hierarchy. Self-reference uses AnyPgColumn (see folderId comment).
    parentId: text("parent_id").references((): AnyPgColumn => mediaFolders.id, {
      onDelete: "cascade",
    }), // Null for root folders

    // Ownership and timestamps
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    index("media_folders_parent_id_idx").on(t.parentId), // For querying subfolders
    index("media_folders_created_by_idx").on(t.createdBy), // For filtering by creator
    index("media_folders_created_at_idx").on(t.createdAt), // For sorting by creation date
  ]
);

/**
 * Image Sizes table for named image size configurations.
 *
 * Stores configured image sizes (thumbnail, medium, large, etc.) that are
 * generated for every uploaded image. Supports both code-first (synced from
 * nextly.config.ts) and Visual (managed in admin Settings) approaches.
 *
 * @example
 * ```typescript
 * await db.insert(imageSizes).values({
 *   name: 'thumbnail',
 *   width: 150,
 *   height: 150,
 *   fit: 'cover',
 *   quality: 80,
 *   format: 'webp',
 * });
 * ```
 */
export const imageSizes = pgTable(
  "image_sizes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Size definition
    name: varchar("name", { length: 50 }).notNull(), // Unique name (e.g., "thumbnail", "medium", "large")
    width: integer("width"), // Target width in pixels (null = auto, keep aspect ratio)
    height: integer("height"), // Target height in pixels (null = auto, keep aspect ratio)
    fit: varchar("fit", { length: 20 }).notNull().default("inside"), // 'cover' | 'inside' | 'contain' | 'fill'
    quality: integer("quality").notNull().default(80), // Image quality 1-100
    format: varchar("format", { length: 10 }).notNull().default("auto"), // 'auto' | 'webp' | 'jpeg' | 'png' | 'avif'

    // Management flags
    isDefault: boolean("is_default").notNull().default(true), // true = applies to all collections
    sortOrder: integer("sort_order").notNull().default(0), // For UI ordering

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [uniqueIndex("image_sizes_name_unique").on(t.name)]
);
