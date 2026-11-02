/**
 * A minimal fixture plugin that injects a component rendering all three
 * plugin-styling layers into the Posts collection list (the `afterList` view
 * injection point — the same battle-tested surface first-party plugins use), so
 * e2e/tests/plugin-admin-styling.spec.ts can prove a plugin's admin UI is styled
 * in the real admin (light and dark). Kept in the playground alongside the
 * form/page builders, which are here for the same reason.
 */
import { definePlugin, defineWidget, setting } from "@nextlyhq/plugin-sdk";

import { STYLE_FIXTURE_PATH } from "./constants";

/**
 * A test fixture for e2e/tests/dashboard-card-settings.spec.ts: a card with
 * settings, one of them quick (Accent, drawn on the card's header), and Rows,
 * which its `load` reads. Drawn by core's list view, so it needs no component.
 * Suggested for the default dashboard; the spec places it itself either way.
 */
const recentPostsWidget = defineWidget({
  id: "style-fixture/recent",
  title: "Fixture recent posts",
  description: "Exists for the e2e suite: recent posts, with a quick setting.",
  size: { default: { w: 4, h: 4 } },
  access: { collections: ["posts"] },
  settings: {
    limit: setting.number({ label: "Rows", defaultValue: 3 }),
    accent: setting.select({
      label: "Accent",
      quick: true,
      defaultValue: "plain",
      options: [
        { label: "Plain", value: "plain" },
        { label: "Bold", value: "bold" },
      ],
    }),
  },
  load: async ({ settings, services, signal }) => {
    const { items } = await services.find("posts", {
      select: ["title"],
      sort: "-updatedAt",
      limit: settings.limit,
      signal,
    });
    return { items };
  },
  view: "list",
});

export const styleFixturePlugin = definePlugin({
  name: "style-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    admin: {
      // Render the showcase after the Posts list.
      views: { posts: { afterList: STYLE_FIXTURE_PATH } },
      // Also expose it as a standalone plugin page at
      // /admin/plugins/style-fixture/showcase, so plugin-page-routing.spec.ts
      // can cover deep-link route resolution.
      pages: [{ path: "/showcase", component: STYLE_FIXTURE_PATH }],
      // Declared for tooling/the plugin doctor; the file is loaded by the
      // side-effect import in ./admin.
      styles: "playground/style-fixture/admin.css",
    },
    dashboard: {
      widgets: [recentPostsWidget],
      suggest: ["style-fixture/recent"],
    },
  },
});
