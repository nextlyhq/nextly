/**
 * A fixture plugin that exists to exercise plugin contributions in the
 * playground: the admin's handling of them, and its screenshots. The browser
 * tests of contributions, and each contribution kind as it is added, use this
 * fixture rather than one of their own.
 *
 * Minimal and inert by design, because every playground boot loads it: no
 * tables, routes, jobs, hooks or seed writes. Today it declares one entry-list
 * filter on Posts, which appears in the list's Filter menu and changes nothing
 * until someone chooses it. Its label names it a fixture, so it doesn't read
 * as product.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

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
    },
  },
});
