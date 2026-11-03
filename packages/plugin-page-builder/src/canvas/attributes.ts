/**
 * The two attributes the canvas route and the editor agree on.
 *
 * The site's page renders the mount point with the first; the second says the
 * site's React root has hydrated it, so the editor may portal the page in.
 * One module both sides import, so the names cannot drift apart: a mismatch
 * would leave every site's canvas falling back to the blank page.
 *
 * @module canvas/attributes
 */

/** Marks the element the editor portals the page into. */
export const CANVAS_MOUNT_ATTRIBUTE = "data-nx-canvas-mount";

/** Set on the mount point once the site's page has hydrated it. */
export const CANVAS_READY_ATTRIBUTE = "data-nx-canvas-ready";
