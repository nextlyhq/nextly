/**
 * "." entry — isomorphic, React-free public API.
 *
 * Exposes the core contracts + open registries (`defineBlock`, `defaultBlockRegistry`,
 * control registry, tree/validate/migrate/style/bindings) and the `pageBuilder()` plugin
 * factory. The React editor lives on `./admin`; the renderer on `./render`.
 */
export * from "./core";
export { pageBuilder } from "./plugin";
export type { PageBuilderOptions } from "./plugin";
export { pagesCollection, EDIT_VIEW_PATH } from "./collections/pages";
export {
  pageBuilderField,
  FIELD_COMPONENT_PATH,
} from "./collections/pageBuilderField";
export type { PageBuilderFieldOptions } from "./collections/pageBuilderField";
export { editorChoiceFields } from "./collections/editorChoice";
export type { EditorChoiceOptions } from "./collections/editorChoice";
export {
  pageBuilderFields,
  PAGE_BUILDER_FIELD_TYPE,
  PAGE_BUILDER_CONTENT_FIELD,
  PAGE_BUILDER_TYPE,
} from "./collections/pageBuilderEntry";
export type {
  PageBuilderAdminConfig,
  EditorMode,
} from "./collections/pageBuilderEntry";
