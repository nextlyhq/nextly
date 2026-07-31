/**
 * Block authoring — the contracts a plugin contributing blocks to the page
 * builder needs.
 *
 * A subpath rather than the SDK's main entry, so a plugin that has nothing to
 * do with blocks never pulls the block engine into its type graph. The SDK
 * remains the single stable import surface a plugin author is offered; this
 * simply keeps a page-builder-specific vocabulary out of everyone else's way.
 *
 * The engine is a real dependency of this package rather than an optional peer,
 * because this module re-exports a VALUE from it: the import has to resolve for
 * an author who installed only the SDK, and under a strict `node_modules`
 * layout the page builder's own copy is not reachable from their package. The
 * engine's registry is pinned to `globalThis`, so even a duplicated install
 * still reads and writes the one registry the page builder consumes.
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

/**
 * @experimental Carried by the same freeze as `defineBlock`: these describe the
 *   definition shape, so they change with it.
 */
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
