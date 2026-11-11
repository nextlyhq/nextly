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
