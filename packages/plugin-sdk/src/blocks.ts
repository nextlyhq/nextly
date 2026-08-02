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
 * because the types below are built on top of its own: they have to resolve for
 * an author who installed only the SDK, and under a strict `node_modules`
 * layout the page builder's copy is not reachable from their package. The
 * engine's registry is pinned to `globalThis`, so even a duplicated install
 * still reads and writes the one registry the page builder consumes.
 *
 * What an author writes is declared here rather than re-exported. `defineBlock`
 * and `BlockSupports` are this module's own so that `BlockSupportKeys` can be
 * augmented from a plugin's source, which only works for a module that plugin
 * can name.
 *
 * The registration side is not here. Contributing a block means calling the
 * page builder's own service — it is that plugin's registry, not core's — so
 * `blockRegistry` comes from `@nextlyhq/plugin-page-builder/blocks`, which is
 * also where a contributor already declares its `dependsOn`.
 *
 * @packageDocumentation
 */

import type {
  BlockDefinition as EngineBlockDefinition,
  BlockSupportValue,
} from "@nextlyhq/blocks-engine";

/**
 * The support keys a block may declare.
 *
 * Declared HERE rather than in the engine, and that placement is the whole
 * point. A module augmentation has to name a module that resolves from the file
 * doing the augmenting, and a plugin author installs this package: under a
 * strict `node_modules` layout the engine is a nested transitive dependency
 * their own source cannot name, so an augmentation pointed at it fails to
 * compile and the custom support silently never arrives.
 *
 * A plugin that calls `registerSupport()` adds its key to the vocabulary the
 * compiler checks against:
 *
 * ```ts
 * declare module "@nextlyhq/plugin-sdk/blocks" {
 *   interface BlockSupportKeys {
 *     animation: true;
 *   }
 * }
 * ```
 *
 * Declaration merging rather than an index signature: an index signature accepts
 * every key, which is what leaves a misspelled `spaceing` to be found at boot,
 * in someone else's app, instead of while it is being written.
 *
 * The built-in keys are the style catalog's groups plus the capabilities that
 * have no catalog group of their own. A test holds this list to what the
 * registry actually accepts, so the two cannot drift.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export interface BlockSupportKeys {
  /** Padding and margin. */
  spacing: true;
  /** Flow, alignment and gap. */
  layout: true;
  /** Width, height and their limits. */
  dimensions: true;
  /** Font, size, weight, line height and letter spacing. */
  typography: true;
  /** Text and other foreground colours. */
  color: true;
  /** Background colour, image and gradient. */
  background: true;
  /** Border lines and corner rounding. */
  border: true;
  /** Box and text shadows. */
  shadow: true;
  /** Opacity, filters and transforms. */
  effects: true;
  /** Positioning and stacking. */
  position: true;
  /** Container-query behaviour. */
  container: true;
  /** Author-written CSS on this block. Gates a capability, not a style group. */
  customCss: true;
}

/**
 * Style capabilities a block opts into: `true` for a whole group, or an object
 * naming the sub-flags it wants.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export type BlockSupports = Partial<
  Record<keyof BlockSupportKeys, BlockSupportValue>
>;

/**
 * One block type, as an author writes it.
 *
 * The engine's own definition leaves `supports` open, because its registry holds
 * blocks from every source and checks their keys at boot against whatever is
 * registered. Authoring is the moment a typo is cheap to catch, so this narrows
 * that one member and changes nothing else.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export interface BlockDefinition<
  P extends object = Record<string, unknown>,
  C = unknown,
> extends Omit<EngineBlockDefinition<P, C>, "supports"> {
  supports?: BlockSupports;
}

/**
 * Declare a block.
 *
 * Returns its argument. It exists to infer `P` and `C` from what is written and
 * to check that against the definition shape, which is what makes a mistyped
 * prop name or an unknown support key a compile error rather than a boot one.
 *
 * @experimental The block API is frozen at the end of the engine phase, not
 *   now. Until then a contributed block may need changes when the definition
 *   shape settles.
 */
export function defineBlock<P extends object, C = unknown>(
  definition: BlockDefinition<P, C>
): BlockDefinition<P, C> {
  return definition;
}

/**
 * @experimental Carried by the same freeze as `defineBlock`: these describe the
 *   definition shape, so they change with it.
 */
export type {
  AnyBlockDefinition,
  BlockRenderArgs,
  BlockRenderResult,
  InferBlockProps,
  PropSchema,
  SupportDefinition,
} from "@nextlyhq/blocks-engine";

/**
 * The rest of the definition's own vocabulary. Every one of these names a field
 * a block author fills in, so leaving them off this surface meant writing a slot
 * template, an example, or an editor entry against a type that could only be
 * reached by importing the engine directly — which is the one thing this subpath
 * exists to make unnecessary.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export type {
  BlockEditorMeta,
  BlockExample,
  BlockSupportValue,
  BlockVariation,
  ComponentPath,
  NodeStyles,
  SlotLock,
  SlotSpec,
} from "@nextlyhq/blocks-engine";
