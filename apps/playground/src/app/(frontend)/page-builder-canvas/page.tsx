/**
 * The page builder's canvas route: an empty mount point inside this site's
 * layouts, which the editor loads into its canvas and draws the page being
 * edited into. Named as `canvasPath` in `nextly.config.ts`.
 *
 * Inside `(frontend)` beside the published pages, so the canvas sits in
 * exactly the layouts and global stylesheets they are published in. A static
 * segment, so Next resolves it before the pages' catch-all.
 *
 * @module app/(frontend)/page-builder-canvas
 */
export { PageBuilderCanvas as default } from "@nextlyhq/plugin-page-builder/canvas";
