/**
 * A fixture plugin that exists to exercise plugin contributions in the
 * playground: the admin's handling of them, its screenshots, and the browser
 * test of a plugin extending a page. The browser tests of contributions, and
 * each contribution kind as it is added, use this fixture rather than one of
 * their own.
 *
 * Minimal and inert by design, because every playground boot loads it: no
 * tables, routes, jobs, hooks or seed writes. It declares one entry-list
 * filter on Posts, which appears in the list's Filter menu and changes nothing
 * until someone chooses it, and contributions to admin places: a block on the
 * dashboard; on a Post's edit page a block, a block behind `update-posts`, a
 * tab and a side panel section; on Posts' list a block, a field column, a
 * column the plugin draws, a row action on drafts and a bulk action; and a
 * replacement of the edit page's `editor` scoped to an e2e-only collection.
 * Each draws a component from `components.tsx`, which the generated component
 * map imports. Every label names it a fixture, so nothing reads as product.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

/** The fixture's components, by what each contribution draws. */
const COMPONENTS = "@/plugins/contributions-fixture/components";
const BLOCK = `${COMPONENTS}#FixtureBlock`;
const GATED_BLOCK = `${COMPONENTS}#FixtureGatedBlock`;
const CELL = `${COMPONENTS}#FixtureCell`;
const TAB = `${COMPONENTS}#FixtureTab`;
const SECTION = `${COMPONENTS}#FixtureSection`;
const ACTION_DIALOG = `${COMPONENTS}#FixtureActionDialog`;
const REPLACEMENT = `${COMPONENTS}#FixtureReplacement`;

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
          component: BLOCK,
        },
        // A Post's edit page: a block, and beside it one behind a permission,
        // so what a reader without it is sent can be seen; a tab; a side
        // panel section after the panel's own Details.
        {
          id: "contributions-fixture.edit-block",
          kind: "block",
          place: "collection.edit",
          collections: ["posts"],
          component: BLOCK,
        },
        {
          id: "contributions-fixture.gated-block",
          kind: "block",
          place: "collection.edit",
          collections: ["posts"],
          component: GATED_BLOCK,
          after: "contributions-fixture.edit-block",
          requiredPermission: "update-posts",
        },
        {
          id: "contributions-fixture.tab",
          kind: "tab",
          place: "collection.edit",
          collections: ["posts"],
          label: "Fixture",
          component: TAB,
        },
        {
          id: "contributions-fixture.section",
          kind: "sidebarSection",
          place: "collection.edit",
          collections: ["posts"],
          label: "Fixture",
          component: SECTION,
          after: "details",
        },
        // Posts' list: a block above the list, a field column, a column whose
        // cell the plugin draws from its row, a row action on drafts and a
        // bulk action, each opening a dialog with the rows it was run on.
        {
          id: "contributions-fixture.list-block",
          kind: "block",
          place: "collection.list",
          collections: ["posts"],
          component: BLOCK,
          before: "table",
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
          id: "contributions-fixture.cell",
          kind: "column",
          place: "collection.list",
          collections: ["posts"],
          label: "Fixture",
          component: CELL,
        },
        {
          id: "contributions-fixture.row-action",
          kind: "rowAction",
          place: "collection.list",
          collections: ["posts"],
          label: "Fixture: inspect",
          action: { open: ACTION_DIALOG },
          visibleWhen: { field: "status", equals: "draft" },
        },
        {
          id: "contributions-fixture.bulk-action",
          kind: "bulkAction",
          place: "collection.list",
          collections: ["posts"],
          label: "Fixture: inspect selected",
          action: { open: ACTION_DIALOG },
        },
        // A replacement of a named built-in block, scoped to a collection the
        // playground registers for the browser tests alone, so no page anyone
        // else uses changes: without that collection it applies to nothing.
        {
          id: "contributions-fixture.replacement",
          kind: "block",
          place: "collection.edit",
          collections: ["contribution-stories"],
          component: REPLACEMENT,
          replaces: "editor",
        },
      ],
    },
  },
});
