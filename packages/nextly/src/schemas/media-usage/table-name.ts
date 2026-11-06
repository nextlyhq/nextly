/**
 * The media usage table's physical name.
 *
 * @module schemas/media-usage/table-name
 */

/** The physical table name, spelled once and read everywhere. */
export const MEDIA_USAGE_TABLE = "nextly_media_usage";

/**
 * The longest field path the table stores, in UTF-8 bytes: MySQL's column
 * holds 255 characters, which the unique index's key length bounds. A longer
 * path is stored bounded (`boundedValue`), on every dialect alike.
 */
export const MEDIA_USAGE_FIELD_PATH_LENGTH = 255;
