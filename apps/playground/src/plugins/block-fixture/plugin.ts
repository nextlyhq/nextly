/**
 * A fixture plugin for the e2e suite: blocks contributed to the page builder
 * by declaration, one with only generated controls, one with its own
 * inspector, one pointing at a post, and a support the second uses.
 * e2e/tests/plugin-blocks.spec.ts inserts them from the Add panel, edits them
 * and reloads the page. A fourth, the environment probe, measures the window
 * it is drawn in, for e2e/tests/plugin-block-frame-environment.spec.ts.
 *
 * Registered only on the e2e suite's own server (`NEXTLY_E2E_STYLE_FIXTURE`),
 * like the other test fixtures, so a contributor's Add panel never offers its
 * blocks. The committed component map is generated with the fixtures off, so
 * it does not import the editor entry or the inspector: `admin.tsx` hands
 * both to the editor itself, through a side-effect import in the playground's
 * admin route.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

import { BLOCK_FIXTURE_EDITOR_ENTRY, blockFixtureContribution } from "./blocks";

export const blockFixturePlugin = definePlugin({
  name: "block-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    declarations: {
      "@nextlyhq/plugin-page-builder": {
        ...blockFixtureContribution,
        // The module exporting the same definitions for the editor.
        editorEntry: BLOCK_FIXTURE_EDITOR_ENTRY,
      },
    },
  },
});
