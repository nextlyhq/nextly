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
export { blocks, isBlocksField } from "./fields/blocksHelper";
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

/**
 * Contributing blocks. `defineBlock` is re-exported here rather than reached
 * through the core SDK: a block is a page-builder concept, and routing it
 * through core's public surface would put the engine's types back into an API
 * that deliberately no longer references them.
 */
export {
  blockRegistry,
  BLOCK_SERVICE,
  PAGE_BUILDER_PLUGIN,
} from "./blocks/registration-service";
export type { BlockRegistrationService } from "./blocks/registration-service";
// `defineBlock` and `BlockDefinition` are NOT re-exported here. The package
// root already exports both from `./core`, where `defineBlock` registers into
// `defaultBlockRegistry` and `BlockDefinition` is the PoC's own shape. An
// explicit re-export would shadow the star export, so a consumer importing
// `defineBlock` from the root would silently get the engine's helper — which
// only returns its argument — and stop registering its blocks.
//
// Block authors take `defineBlock` from `@nextlyhq/blocks-engine` directly
// until the PoC registry is removed and the name is free.
export type { AnyBlockDefinition } from "@nextlyhq/blocks-engine";
