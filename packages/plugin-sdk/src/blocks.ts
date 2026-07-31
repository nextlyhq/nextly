/**
 * Block authoring — the contracts a plugin contributing blocks to the page
 * builder needs.
 *
 * A subpath rather than the SDK's main entry, so a plugin that has nothing to
 * do with blocks never pulls the block engine into its type graph. The SDK
 * remains the single stable import surface a plugin author is offered; this
 * simply keeps a page-builder-specific vocabulary out of everyone else's way.
 *
 * The registration side is not here. Contributing a block means calling the
 * page builder's own service — it is that plugin's registry, not core's — so
 * `blockRegistry` comes from `@nextlyhq/plugin-page-builder/blocks`, which is
 * also where a contributor already declares its `dependsOn`.
 *
 * @packageDocumentation
 */

/**
 * @experimental The block API is frozen at the end of the engine phase, not
 *   now. Until then a contributed block may need changes when the definition
 *   shape settles.
 */
export { defineBlock } from "@nextlyhq/blocks-engine";
export type {
  AnyBlockDefinition,
  BlockDefinition,
  BlockRenderArgs,
  BlockRenderResult,
  BlockSupports,
  InferBlockProps,
  PropSchema,
  SupportDefinition,
} from "@nextlyhq/blocks-engine";
