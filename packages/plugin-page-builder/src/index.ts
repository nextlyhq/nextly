/**
 * "." entry — isomorphic, React-free public API.
 *
 * The plugin is a REGISTRATION surface: it declares the `blocks` field, the
 * pages collection, the permissions and the registry a plugin hands its blocks
 * to. It renders nothing and defines no document model of its own.
 *
 * Both of those used to live here. The package carried a complete parallel
 * implementation — its own `BlockDocument` and `BlockNode`, its own style
 * compiler, its own block library and its own editor — beside the ones in
 * `@nextlyhq/blocks-engine`, `@nextlyhq/blocks-react` and `@nextlyhq/builder`.
 * The two did not merely duplicate each other; they disagreed about what values
 * MEAN. A page's nodes sat under a synthetic root here and in a flat array
 * there, a design token was keyed `token` here and `$token` there, per-node
 * visibility was a flat breakpoint map here and a nested one there, and a
 * binding was a different contract entirely. Each of those crossed a boundary
 * without a type error and changed what rendered.
 *
 * Keeping both was not a cost paid once. It meant every document question had
 * two answers that had to be kept in agreement by hand, and the disagreements
 * only ever surfaced as a page that looked wrong — never as something that
 * failed to compile.
 *
 * So the document model, the style compiler, the block library and the editor
 * are the engine's, the renderer's and the builder's respectively, and this
 * package registers them. The editor is `@nextlyhq/builder`; blocks render
 * through `@nextlyhq/blocks-react`.
 */
export { pageBuilder } from "./plugin";
export type { PageBuilderOptions } from "./plugin";

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
export { pagesCollection } from "./collections/pages";
/*
 * `editorChoiceFields` is gone, along with the per-entry editor switch.
 *
 * It spread a stored `editorMode` select beside a blocks field and a rich-text
 * one. Removed rather than deprecated because what it produced was a COLUMN:
 * leaving it exported would keep new collections writing a UI preference into
 * content, and the whole point of retiring it is that the field decides.
 *
 * A collection that used it keeps both underlying fields until its owner
 * removes them — this stops NEW ones being created, and deletes no data.
 * Replace the spread with `blocks({ name: "content" })` for a page-built entry,
 * or `richText({ name: "body" })` for a written one.
 */

/**
 * Contributing blocks: the registry a plugin hands its blocks to.
 *
 * Only the registration side is here, because that is what belongs to this
 * plugin. The contracts for authoring a block come from
 * `@nextlyhq/plugin-sdk/blocks`, the stable surface a plugin author is offered.
 */
export {
  blockRegistry,
  BLOCK_SERVICE,
  PAGE_BUILDER_PLUGIN,
} from "./blocks/registration-service";
export type { BlockRegistrationService } from "./blocks/registration-service";
// `defineBlock` and `BlockDefinition` are still not re-exported from this root,
// and the reason has changed rather than gone away. There is no longer a rival
// `defineBlock` here to shadow; instead the name belongs to the engine, and a
// second route to it from a plugin package is a second thing to keep stable.
// Block authors take both from `@nextlyhq/plugin-sdk/blocks`, where the export
// is covered by the SDK's stability ledger.
export type { AnyBlockDefinition } from "@nextlyhq/blocks-engine";
