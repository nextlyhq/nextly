/**
 * The surface a plugin contributing blocks imports from.
 *
 * A subpath rather than the package root, because the root already exports a
 * different `defineBlock` from the PoC registry (`core/registry.ts`) and
 * re-exporting this one there would shadow it — silently turning an existing
 * consumer's registering helper into one that only returns its argument.
 *
 * Only the REGISTRATION side lives here. The block contracts themselves —
 * `defineBlock` and the definition types — come from `@nextlyhq/plugin-sdk/blocks`,
 * because the SDK is the stable import surface a plugin author is offered. What
 * belongs here is what is specific to this plugin: the registry a contributor
 * hands its blocks to, and the name it declares in `dependsOn`.
 *
 * @module blocks
 */

export {
  blockRegistry,
  BLOCK_SERVICE,
  PAGE_BUILDER_PLUGIN,
} from "./registration-service";
export type { BlockRegistrationService } from "./registration-service";

/**
 * The renderer's own context declaration.
 *
 * Re-exported from the package's published entry so the augmentation it carries
 * reaches a consumer's type graph. A plugin importing only the documented
 * subpaths would otherwise never load that file, and `ctx.data` — the whole
 * point of the context — would not exist for them.
 */
export type { DataProvider, FindArgs, QueryBudget } from "./context";
