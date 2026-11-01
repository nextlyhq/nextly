/**
 * A fixture plugin for the e2e suite: two blocks contributed to the page
 * builder by declaration, one with only generated controls and one with its
 * own inspector, and a support the second uses. e2e/tests/plugin-blocks.spec.ts
 * inserts both from the Add panel, edits them and reloads the page.
 *
 * Always registered, like the widget-kit fixture: its editor entry and
 * inspector must be in the committed component map, which is generated with
 * the gated fixtures off. Its blocks appear only in the Add panel, named as
 * test fixtures, and on no page unless someone places one.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

import { blockFixtureContribution } from "./blocks";

export const blockFixturePlugin = definePlugin({
  name: "block-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    declarations: {
      "@nextlyhq/plugin-page-builder": {
        ...blockFixtureContribution,
        // The module exporting the same definitions for the editor.
        editorEntry: "@/plugins/block-fixture/editor#blockFixtureEditor",
      },
    },
  },
});
