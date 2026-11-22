"use client";

/**
 * Hands the block fixture's editor entry and custom inspector to the page
 * builder's editor, by a side-effect import in the playground's admin route.
 *
 * The generated component map does this for every block a site's plugins
 * declare. The fixture runs only on the e2e suite's own server, and the
 * committed map is written without it, so it hands its modules over itself,
 * under the same paths its declaration names. As the map does, the inspector
 * is registered as a component too, so it resolves by path like any other.
 */
import { registerBlockEditorModules } from "@nextlyhq/plugin-page-builder/admin";
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import {
  BLOCK_FIXTURE_EDITOR_ENTRY,
  CUSTOM_INSPECTOR_COMPONENT,
} from "./blocks";
import { blockFixtureEditor, FixtureInspector } from "./editor";

// Only with the switch on. Unlike a component nothing declares, an entry
// handed over is offered: the editor registers every block of every entry it
// is given, and the Add panel lists them. `next.config.ts` passes the switch
// to the browser bundle, read the same way the config reads it.
if (process.env.NEXTLY_E2E_STYLE_FIXTURE === "1") {
  registerBlockEditorModules({
    entries: { [BLOCK_FIXTURE_EDITOR_ENTRY]: blockFixtureEditor },
    components: { [CUSTOM_INSPECTOR_COMPONENT]: FixtureInspector },
  });
  registerComponents({ [CUSTOM_INSPECTOR_COMPONENT]: FixtureInspector });
}
