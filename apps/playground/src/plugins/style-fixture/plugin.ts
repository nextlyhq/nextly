/**
 * A minimal fixture plugin that injects a component rendering all three
 * plugin-styling layers into the Posts collection list (the `afterList` view
 * injection point — the same battle-tested surface first-party plugins use), so
 * e2e/tests/plugin-admin-styling.spec.ts can prove a plugin's admin UI is styled
 * in the real admin (light and dark). Kept in the playground alongside the
 * form/page builders, which are here for the same reason.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

import { STYLE_FIXTURE_PATH } from "./constants";

export const styleFixturePlugin = definePlugin({
  name: "style-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    admin: {
      // Render the showcase after the Posts list.
      views: { posts: { afterList: STYLE_FIXTURE_PATH } },
      // Declared for tooling/the plugin doctor; the file is loaded by the
      // side-effect import in ./admin.
      styles: "playground/style-fixture/admin.css",
    },
  },
});
