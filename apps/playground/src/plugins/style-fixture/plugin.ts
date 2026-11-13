/**
 * A minimal fixture plugin that injects a component rendering all three
 * plugin-styling layers into the Posts collection list (the `afterList` view
 * injection point — the same battle-tested surface first-party plugins use), so
 * e2e/tests/plugin-admin-styling.spec.ts can prove a plugin's admin UI is styled
 * in the real admin (light and dark). Kept in the playground alongside the
 * form/page builders, which are here for the same reason.
 */
import {
  defineAttentionItem,
  definePlugin,
  defineWidget,
  setting,
} from "@nextlyhq/plugin-sdk";
import { defineCollection, text } from "nextly/config";

import {
  CHECKS_SLUG,
  FILL_PROBE_PATH,
  BLOCK_PAGE_PATHS,
  FRAME_PAGE_PATHS,
  PANEL_PAGE_PATHS,
  STYLE_FIXTURE_PATH,
  SWATCH_TO_FIX,
  SWATCHES_SLUG,
} from "./constants";

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

/**
 * The fixture's library, counted by its panel's quiet count. Hidden from the
 * navigation, as a plugin's own library collections often are, so the panel's
 * count is read for a collection the dashboard leaves out: reached through
 * the panel's item alone.
 */
const swatches = defineCollection({
  slug: SWATCHES_SLUG,
  labels: { singular: "Swatch", plural: "Swatches" },
  admin: { hidden: true },
  fields: [
    text({ name: "title", label: "Title" }),
    text({ name: "state", label: "State" }),
  ],
});

/**
 * The fixture's checks, which its Needs your attention items count. Listed,
 * not hidden: an item gated on collections shows only to a reader of one the
 * dashboard lists.
 */
const checks = defineCollection({
  slug: CHECKS_SLUG,
  labels: { singular: "Fixture check", plural: "Fixture check rows" },
  fields: [
    text({ name: "title", label: "Title" }),
    text({ name: "state", label: "State" }),
  ],
});

/** Where the fixture's own pages are, as a menu item links to one. */
const pageHref = (path: string) => `/admin/plugins/style-fixture/${path}`;

/**
 * Two Needs your attention items, read by the panel's badges. Both count 0
 * until a browser test stores a check in the state they count, so on every
 * other run the dashboard's card is as it would be without them.
 */
const checksAttention = defineAttentionItem({
  id: "style-fixture/checks",
  label: "Fixture checks to fix",
  collections: [CHECKS_SLUG],
  link: `plugins/style-fixture/${PANEL_PAGE_PATHS.checks}`,
  count: ({ services }) =>
    services.count(CHECKS_SLUG, {
      where: { state: { equals: SWATCH_TO_FIX } },
    }),
});
const quietAttention = defineAttentionItem({
  id: "style-fixture/quiet",
  label: "Fixture checks never flagged",
  collections: [CHECKS_SLUG],
  link: `plugins/style-fixture/${PANEL_PAGE_PATHS.quiet}`,
  count: ({ services }) =>
    services.count(CHECKS_SLUG, {
      where: { state: { equals: "never-set" } },
    }),
});

export const styleFixturePlugin = definePlugin({
  name: "style-fixture",
  version: "0.0.0",
  nextly: "*",
  // Its own rail item and panel, for plugin-panel-declarations.spec.ts: the
  // panel's groups, and its items' counts and badges.
  admin: {
    placement: "standalone",
    after: "plugins",
    appearance: { icon: "Box", label: "Style fixture" },
  },
  contributes: {
    collections: [swatches, checks],
    admin: {
      panel: {
        groups: [
          { id: "library", label: "Library" },
          { id: "checks", label: "Checks" },
        ],
      },
      menu: [
        // Naming no group: listed first, under no heading.
        {
          label: "Fixture overview",
          to: pageHref(PANEL_PAGE_PATHS.overview),
          icon: "LayoutDashboard",
        },
        {
          label: "Swatches to fix",
          to: `/admin/collections/${SWATCHES_SLUG}`,
          collection: SWATCHES_SLUG,
          group: "library",
          count: {
            collection: SWATCHES_SLUG,
            where: { state: { equals: SWATCH_TO_FIX } },
          },
        },
        {
          label: "Fixture checks",
          to: pageHref(PANEL_PAGE_PATHS.checks),
          group: "checks",
          badge: { attention: "style-fixture/checks" },
        },
        {
          label: "Quiet checks",
          to: pageHref(PANEL_PAGE_PATHS.quiet),
          group: "checks",
          badge: { attention: "style-fixture/quiet" },
        },
      ],
      // Render the showcase after the Posts list.
      // And a document view that only fills its box, at
      // /admin/collections/posts/<id>/fill-probe, for the view-height test.
      views: {
        posts: {
          afterList: STYLE_FIXTURE_PATH,
          documentViews: [{ path: "fill-probe", component: FILL_PROBE_PATH }],
        },
      },
      // Also expose it as a standalone plugin page at
      // /admin/plugins/style-fixture/showcase, so plugin-page-routing.spec.ts
      // can cover deep-link route resolution.
      // And a page per page type drawn with the SDK's frame and header, and
      // one drawn with neither, for plugin-page-frames.spec.ts.
      //
      // Each keeps to the Plugins section, where it was before the fixture
      // had a panel of its own, so those specs read the page they always did.
      // The panel's own pages draw the showcase too, in the fixture's panel.
      pages: [
        {
          path: "/showcase",
          component: STYLE_FIXTURE_PATH,
          section: "plugins",
        },
        ...Object.entries(FRAME_PAGE_PATHS).map(([path, component]) => ({
          path,
          component,
          section: "plugins" as const,
        })),
        ...Object.entries(BLOCK_PAGE_PATHS).map(([path, component]) => ({
          path,
          component,
          section: "plugins" as const,
        })),
        ...Object.values(PANEL_PAGE_PATHS).map(path => ({
          path,
          component: STYLE_FIXTURE_PATH,
        })),
      ],
      // Declared for tooling/the plugin doctor; the file is loaded by the
      // side-effect import in ./admin.
      styles: "playground/style-fixture/admin.css",
    },
    dashboard: {
      widgets: [recentPostsWidget],
      suggest: ["style-fixture/recent"],
      attention: [checksAttention, quietAttention],
    },
  },
});
