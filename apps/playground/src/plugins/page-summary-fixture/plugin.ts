/**
 * A fixture plugin for the e2e suite: it adds a "Summary" field to the Page
 * Builder's Pages, as a site's developer adds a field to a collection, so the
 * browser test of the builder's Page settings finds it on the Fields tab with
 * no change to the builder (e2e/tests/builder-page-settings-tabs.spec.ts).
 *
 * Optional, so every other test that makes a page through the API still
 * makes one; with a rule on what it may hold, so the same test has a value a
 * save refuses. Registered only where the browser suite runs its fixtures
 * (`NEXTLY_E2E_STYLE_FIXTURE`). No tables of its own, routes, jobs or hooks.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { text } from "nextly/config";

/** What a save says of a summary holding angle brackets. */
const PAGE_SUMMARY_RULE = "A summary can't hold < or >.";

export const pageSummaryFixturePlugin = definePlugin({
  name: "page-summary-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    extend: [
      {
        target: ["pages"],
        fields: [
          text({
            name: "summary",
            label: "Summary",
            validation: { pattern: "^[^<>]*$", message: PAGE_SUMMARY_RULE },
          }),
        ],
      },
    ],
  },
});
