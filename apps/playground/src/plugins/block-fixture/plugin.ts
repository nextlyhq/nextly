/**
 * A fixture plugin for the e2e suite: blocks contributed to the page builder
 * by declaration, one with only generated controls, one with its own
 * inspector, one pointing at a post, and a support the second uses.
 * e2e/tests/plugin-blocks.spec.ts inserts them from the Add panel, edits them
 * and reloads the page. A fourth, the environment probe, measures the window
 * it is drawn in, for e2e/tests/plugin-block-frame-environment.spec.ts.
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
