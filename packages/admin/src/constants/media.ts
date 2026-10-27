/**
 * Grid classes for the media library layout. As many columns of at least 9rem
 * as the grid's own width holds, rather than a count per window width: the
 * details panel and the folder tree take width from the grid without the
 * window changing, and a fixed six columns beside them shrank every tile.
 */
export const MEDIA_GRID_CLASSES =
  "grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4" as const;

/** Default number of skeleton items to show during loading. */
export const DEFAULT_MEDIA_SKELETON_COUNT = 12;

/**
 * The media sort menu's options, as `<field>-<order>` values. One list for the
 * library's toolbar and the media picker, so the two offer the same orders
 * under the same names.
 */
export const MEDIA_SORT_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "uploadedAt-desc", label: "Newest First" },
  { value: "uploadedAt-asc", label: "Oldest First" },
  { value: "filename-asc", label: "Name A-Z" },
  { value: "filename-desc", label: "Name Z-A" },
  { value: "size-desc", label: "Largest First" },
  { value: "size-asc", label: "Smallest First" },
];
