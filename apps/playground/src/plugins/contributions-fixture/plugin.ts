/**
 * A fixture plugin that exists to exercise plugin contributions in the
 * playground: the admin's handling of them, and its screenshots. The browser
 * tests of contributions, and each contribution kind as it is added, use this
 * fixture rather than one of their own.
 *
 * Minimal and inert by design, because every playground boot loads it: no
 * tables, routes, jobs, hooks or seed writes. It declares one entry-list
 * filter on Posts, which appears in the list's Filter menu and changes nothing
 * until someone chooses it, and one contribution of each kind to an admin
 * place: a dashboard block, a column, a row action and a bulk action on
 * Posts' list, and a tab and a side panel section on a Post's edit page. The
 * row action ("Fixture: inspect", on draft posts) appears in the Posts list's
 * row menu; it opens a component this folder does not provide, so it shows
 * the slot's fallback. The rest arrive as data in the admin's metadata, each
 * naming that component by path, and are not drawn yet. One block asks for a
 * permission, so what a reader without it is sent can be seen. Every label
 * names it a fixture, so nothing reads as product.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

/** The one component every contribution here names. */
const FIXTURE_COMPONENT =
  "@/plugins/contributions-fixture/contribution#FixtureContribution";

export const contributionsFixturePlugin = definePlugin({
  name: "contributions-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    admin: {
      filters: [
        {
          name: "contributions-fixture.excerpt",
          label: "Fixture: excerpt",
          collections: ["posts"],
          options: [
            {
              value: "with",
              label: "With an excerpt",
              where: { excerpt: { exists: true } },
            },
            {
              value: "without",
              label: "Without an excerpt",
              where: { excerpt: { exists: false } },
            },
          ],
        },
      ],
      contributions: [
        {
          id: "contributions-fixture.block",
          kind: "block",
          place: "dashboard",
          component: FIXTURE_COMPONENT,
        },
        {
          id: "contributions-fixture.gated-block",
          kind: "block",
          place: "dashboard",
          component: FIXTURE_COMPONENT,
          after: "contributions-fixture.block",
          requiredPermission: "update-posts",
        },
        {
          id: "contributions-fixture.column",
          kind: "column",
          place: "collection.list",
          collections: ["posts"],
          label: "Fixture: slug",
          field: "slug",
        },
        {
          id: "contributions-fixture.row-action",
          kind: "rowAction",
          place: "collection.list",
          collections: ["posts"],
          label: "Fixture: inspect",
          action: { open: FIXTURE_COMPONENT },
          visibleWhen: { field: "status", equals: "draft" },
        },
        {
          id: "contributions-fixture.bulk-action",
          kind: "bulkAction",
          place: "collection.list",
          collections: ["posts"],
          label: "Fixture: inspect selected",
          action: { open: FIXTURE_COMPONENT },
        },
        // The entry list's own drawing, for its screenshots: a block above
        // Posts' list, and a column whose cell the plugin draws.
        {
          id: "contributions-fixture.list-block",
          kind: "block",
          place: "collection.list",
          collections: ["posts"],
          component: FIXTURE_COMPONENT,
          before: "table",
        },
        {
          id: "contributions-fixture.cell",
          kind: "column",
          place: "collection.list",
          collections: ["posts"],
          label: "Fixture: cell",
          component: FIXTURE_COMPONENT,
        },
        {
          id: "contributions-fixture.tab",
          kind: "tab",
          place: "collection.edit",
          collections: ["posts"],
          label: "Fixture",
          component: FIXTURE_COMPONENT,
        },
        {
          id: "contributions-fixture.section",
          kind: "sidebarSection",
          place: "collection.edit",
          collections: ["posts"],
          label: "Fixture",
          component: FIXTURE_COMPONENT,
          after: "details",
        },
      ],
    },
  },
});
