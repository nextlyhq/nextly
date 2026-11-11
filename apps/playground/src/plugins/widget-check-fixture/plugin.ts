/**
 * A fixture plugin for the e2e suite: one admin page, at
 * `/admin/plugins/widget-check-fixture/widgets`, that draws every widget the
 * reader may see from its declared preview cases, in each state, and checks
 * each drawn state's accessibility (e2e/tests/widget-preview.spec.ts).
 *
 * The page is a test page, never a product one: the admin a site ships has no
 * such page, and this plugin is registered only on the e2e suite's own server
 * (`NEXTLY_E2E_WIDGET_CHECK`). It draws inside the admin so every card is
 * drawn by the admin's own declarations, theme and permissions, exactly as the
 * dashboard draws it. Inert otherwise: no tables, routes, jobs, hooks or menu
 * entry.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

import { WIDGET_CHECK_PAGE, WIDGET_CHECK_PAGE_PATH } from "./constants";

export const widgetCheckFixturePlugin = definePlugin({
  name: "widget-check-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    admin: {
      pages: [{ path: WIDGET_CHECK_PAGE, component: WIDGET_CHECK_PAGE_PATH }],
    },
  },
});
