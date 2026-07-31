/**
 * The surface a plugin contributing blocks imports from.
 *
 * A subpath rather than the package root, because the root already exports a
 * different `defineBlock` from the PoC registry (`core/registry.ts`) and
 * re-exporting this one there would shadow it — silently turning an existing
 * consumer's registering helper into one that only returns its argument.
 *
 * The page builder rather than `@nextlyhq/plugin-sdk`, because a block is a
 * page-builder concept: routing it through the core SDK would put the engine's
 * types back into an API that deliberately no longer references them. The page
 * builder is a published package that states its own version, so a contributor
 * pins compatibility with `dependsOn` exactly as it would for any other plugin
 * it builds on.
 *
 * @module blocks
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
} from "@nextlyhq/blocks-engine";

export {
  blockRegistry,
  BLOCK_SERVICE,
  PAGE_BUILDER_PLUGIN,
} from "./registration-service";
export type { BlockRegistrationService } from "./registration-service";
