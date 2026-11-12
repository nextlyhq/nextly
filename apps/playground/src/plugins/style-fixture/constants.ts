/**
 * Client-free constants shared by the plugin definition (loaded in a Node
 * config context) and the admin component (loaded in the browser). Keeping the
 * component-path string here means `plugin.ts` never imports the client
 * component, so loading `nextly.config.ts` doesn't pull admin/React into Node.
 */
export const STYLE_FIXTURE_PATH = "playground/style-fixture#Showcase";

/**
 * A document view on posts that does nothing but fill the box the admin gives
 * it, so a browser test can measure that box against the page's content area.
 */
export const FILL_PROBE_PATH = "playground/style-fixture#FillProbe";

/**
 * Plugin pages drawn from the SDK's page frame and header, one per page type,
 * and one that draws neither, for e2e/tests/plugin-page-frames.spec.ts. Each
 * page's address under `/admin/plugins/style-fixture/` is its key here.
 */
export const FRAME_PAGE_PATHS = {
  "frame-list": "playground/style-fixture#FrameListPage",
  "frame-form": "playground/style-fixture#FrameFormPage",
  "frame-editor": "playground/style-fixture#FrameEditorPage",
  "frame-workspace": "playground/style-fixture#FrameWorkspacePage",
  "frame-none": "playground/style-fixture#UnframedPage",
} as const;

/**
 * The fixture's own collection, hidden from the navigation and counted by
 * its standalone panel, for e2e/tests/plugin-panel-declarations.spec.ts.
 * Registered with the fixture, so only on the e2e server.
 */
export const SWATCHES_SLUG = "style-fixture-swatches";

/**
 * The fixture's checks, listed in its panel and counted by its Needs your
 * attention items. Not hidden: Needs your attention shows an item gated on
 * collections only to a reader of one of them as the dashboard lists them,
 * and the dashboard leaves a hidden collection out.
 */
export const CHECKS_SLUG = "style-fixture-checks";

/** A swatch or a check whose `state` is this is one the panel counts. */
export const SWATCH_TO_FIX = "to-fix";

/** The panel's own pages, under `/admin/plugins/style-fixture/`. */
export const PANEL_PAGE_PATHS = {
  overview: "panel-overview",
  checks: "panel-checks",
  quiet: "panel-quiet",
} as const;
