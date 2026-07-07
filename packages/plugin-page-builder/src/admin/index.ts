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
import { PageBuilderField } from "./PageBuilderField";
import { PageBuilderModeToggle } from "./PageBuilderModeToggle";
import { PageBuilderToggle } from "./PageBuilderToggle";

// Register the built-in inspector controls into the (open) control registry on load.
registerDefaultControls();

const EDIT_VIEW_PATH =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderEditView";
// Must match FIELD_COMPONENT_PATH exported from the "." entry (pageBuilderField).
const FIELD_PATH = "@nextlyhq/plugin-page-builder/admin#PageBuilderField";
// Schema-builder slot component (contributes.admin.schemaBuilderSlot).
const TOGGLE_PATH = "@nextlyhq/plugin-page-builder/admin#PageBuilderToggle";
// Entry-form toolbar slot component (contributes.admin.entryFormToolbarSlot).
const MODE_TOGGLE_PATH =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderModeToggle";
const COMPONENTS = {
  [EDIT_VIEW_PATH]: PageBuilderEditView,
  [FIELD_PATH]: PageBuilderField,
  [TOGGLE_PATH]: PageBuilderToggle,
  [MODE_TOGGLE_PATH]: PageBuilderModeToggle,
};

// Eager registration on module load.
registerComponents(COMPONENTS);

// Lazy fallback: the host can trigger registration on demand by package prefix.
registerKnownPlugin("@nextlyhq/plugin-page-builder", () => {
  registerComponents(COMPONENTS);
  return Promise.resolve();
});

export { PageBuilderEditView };
export { PageBuilderField };
export { PageBuilderToggle };
export { PageBuilderModeToggle };
export type { CustomEditViewProps } from "./types";
