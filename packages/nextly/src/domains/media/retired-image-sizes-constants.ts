/**
 * The names of what image sizes left behind in a database: the media column
 * that recorded each item's size files, the table that held the size
 * definitions, and the command that removes the files and then drops both.
 * Apart from the removal itself, so the schema reconcile and the extension
 * draft can name them without loading storage code.
 *
 * @module domains/media/retired-image-sizes-constants
 */

/** The media column the sizes were stored in. */
export const RETIRED_SIZES_COLUMN = "sizes";

/** The table the size definitions were kept in. */
export const RETIRED_IMAGE_SIZES_TABLE = "image_sizes";

/** The command that removes the size files, as an operator types it. */
export const REMOVE_SIZES_COMMAND = "nextly media remove-sizes";

/** The same command when it also drops the column and the table. */
export const DROP_SIZES_COMMAND = `${REMOVE_SIZES_COMMAND} --apply --drop`;

/**
 * Whether a column contributed to a core table takes a name kept for what
 * image sizes left: `sizes` on `media`. The name stays reserved after the
 * column is gone, so a `sizes` column on the media table can only ever be the
 * one image sizes were stored in, and nothing reads, clears or drops another.
 */
export function isReservedCoreColumn(table: string, column: string): boolean {
  return table === "media" && column === RETIRED_SIZES_COLUMN;
}
