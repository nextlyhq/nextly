/**
 * "." entry — isomorphic, React-free public API.
 *
 * Exposes the core contracts + open registries (`defineBlock`, `defaultBlockRegistry`,
 * control registry, tree/validate/migrate/style/bindings) and the `pageBuilder()` plugin
 * factory. The React editor lives on `./admin`; the renderer on `./render`.
 */
export * from "./core";
export { pageBuilder } from "./plugin";

// The blocks field type and the document it stores. `BlockDocument` is
// re-exported here because generated types name it: an app depends on this
// package, and reaching the engine by name would rely on a transitive
// dependency it has no guarantee of resolving.
export type {
  BlockDocument,
  BlockNode,
  DocumentKind,
} from "@nextlyhq/blocks-engine";
export {
  BLOCKS_FIELD_TYPE,
  BLOCKS_TYPE,
  BLOCKS_FIELD_COMPONENT,
} from "./fields/blocksField";
export {
  emptyBlockDocument,
  emptyBlockDocumentJson,
} from "./fields/blocks-document";
export { validateBlocksValue } from "./fields/blocks-validator";
export type { BlocksValidationOptions } from "./fields/blocks-validator";
export type {
  BlocksFieldOptions,
  BlocksFieldValue,
  BlocksFieldConfig,
} from "./fields/blocks-options";
export { blocks } from "./fields/blocksHelper";
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
  withPageBuilder,
  PAGE_BUILDER_FIELD_TYPE,
  PAGE_BUILDER_CONTENT_FIELD,
  PAGE_BUILDER_TYPE,
} from "./collections/pageBuilderEntry";
export type {
  PageBuilderAdminConfig,
  EditorMode,
} from "./collections/pageBuilderEntry";
