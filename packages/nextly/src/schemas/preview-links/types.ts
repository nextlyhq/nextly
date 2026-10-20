/**
 * Value types shared by the preview-link table on every dialect.
 *
 * @module schemas/preview-links/types
 */

/** What a recorded link previews: one collection entry, or one Single. */
export type PreviewLinkDocumentKind = "entry" | "single";

/** The table's name, the same on every dialect. */
export const PREVIEW_LINKS_TABLE = "nextly_preview_links";
