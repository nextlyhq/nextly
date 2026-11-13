/**
 * A fixture plugin for the e2e suite: one admin page, at
 * `/admin/plugins/startup-read-fixture/greeting`, that reads one route of its
 * own as it opens and declares that read as its startup read, so a tab opening
 * on the page asks for it inside the admin's startup request
 * (e2e/tests/plugin-screen-startup-reads.spec.ts).
 *
 * A test page, never a product one: registered only where the browser suite
 * runs its fixtures (`NEXTLY_E2E_STYLE_FIXTURE`). No tables, jobs, hooks or
 * menu entry.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

import {
  STARTUP_READ_GREETING,
  STARTUP_READ_PAGE,
  STARTUP_READ_PAGE_COMPONENT,
  STARTUP_READ_PLUGIN,
  STARTUP_READ_ROUTE,
} from "./constants";

export const startupReadFixturePlugin = definePlugin({
  name: STARTUP_READ_PLUGIN,
  version: "0.0.0",
  nextly: "*",
  contributes: {
    admin: {
      pages: [
        {
          path: STARTUP_READ_PAGE,
          component: STARTUP_READ_PAGE_COMPONENT,
          startupReads: [{ path: STARTUP_READ_ROUTE }],
        },
      ],
    },
    routes: [
      {
        method: "GET",
        path: STARTUP_READ_ROUTE,
        // Whoever may read posts, as the suite's accounts may: a permission
        // the playground always seeds.
        requiredPermission: "read-posts",
        handler: () => Response.json({ message: STARTUP_READ_GREETING }),
      },
    ],
  },
});
