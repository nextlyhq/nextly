/**
 * "./admin" entry — registers the plugin's React admin components (D19/D60). Importing
 * this module (via the host's generated import map, or eagerly) makes the string-path
 * components resolvable by the admin shell.
 */
import {
  registerComponents,
  registerKnownPlugin,
} from "@nextlyhq/plugin-sdk/admin";

import { registerDefaultControls } from "./controls/registerDefaultControls";
import { PageBuilderEditView } from "./PageBuilderEditView";

// Register the built-in inspector controls into the (open) control registry on load.
registerDefaultControls();

const EDIT_VIEW_PATH =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderEditView";
const COMPONENTS = { [EDIT_VIEW_PATH]: PageBuilderEditView };

// Eager registration on module load.
registerComponents(COMPONENTS);

// Lazy fallback: the host can trigger registration on demand by package prefix.
registerKnownPlugin("@nextlyhq/plugin-page-builder", () => {
  registerComponents(COMPONENTS);
  return Promise.resolve();
});

export { PageBuilderEditView };
export type { CustomEditViewProps } from "./types";
