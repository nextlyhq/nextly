/**
 * @nextlyhq/plugin-sdk/admin — the author-facing surface for plugin admin UI
 * (D19/D43). Register the React components referenced by `contributes.admin`
 * (menu/pages/settings/views) here, in a module imported by the Nextly admin
 * shell (which provides `@nextlyhq/admin` + React).
 *
 * @experimental
 */
export {
  registerComponent,
  registerComponents,
  registerKnownPlugin,
} from "@nextlyhq/admin";
export type { ComponentPath } from "@nextlyhq/admin";

// The declarative `contributes.admin` contract types (the same ones exported
// from the package root) for convenience when authoring admin components.
export type {
  PluginAdminContributions,
  PluginAdminPage,
  PluginCollectionView,
  PluginMenuItem,
} from "nextly";
