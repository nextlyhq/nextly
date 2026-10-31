/**
 * The names of what image sizes left behind in a database: the media column
 * that recorded each item's size files, the table that held the size
 * definitions, and the command that removes the files. Apart from the removal
 * itself, so the schema reconcile can name them without loading storage code.
 *
 * @module domains/media/retired-image-sizes-constants
 */

/** The media column the sizes were stored in. */
export const RETIRED_SIZES_COLUMN = "sizes";

/** The table the size definitions were kept in. */
export const RETIRED_IMAGE_SIZES_TABLE = "image_sizes";

/** The command that removes the size files, as an operator types it. */
export const REMOVE_SIZES_COMMAND = "nextly media remove-sizes";
