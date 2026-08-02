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
  BlockRenderArgs as EngineBlockRenderArgs,
  BlockSupportValue,
} from "@nextlyhq/blocks-engine";
import type { ReactNode } from "react";

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
 * Supports as written at a definition, with unknown keys refused.
 *
 * TypeScript checks for excess properties only on a literal written in place,
 * so lifting settings into a shared object skips it: `const shared = { spacing:
 * true, spaceing: true }` assigns to `BlockSupports` without complaint, and the
 * typo survives to be caught at boot in someone else's app — which is the whole
 * failure this vocabulary exists to move earlier.
 *
 * Naming the offending key as `never` refuses it wherever it was written.
 */
type ExactSupports<S> = S & {
  [K in Exclude<keyof S, keyof BlockSupportKeys>]: never;
};

/**
 * Everything a renderer makes available to every block it draws.
 *
 * ONE description per app, rather than each block inventing its own. A block
 * author writes `defineBlock<MyProps>` and `ctx` is already typed as whatever
 * this app's renderer provides, with no type written by hand; a block that
 * needs something unusual has to add it here, which is an app-wide statement
 * anyone can see rather than a quiet assumption inside one file.
 *
 * A renderer declares what it supplies by augmenting this from its own package:
 *
 * ```ts
 * declare module "@nextlyhq/plugin-sdk/blocks" {
 *   interface BlockRenderContext {
 *     data?: DataProvider;
 *   }
 * }
 * ```
 *
 * `locale` is here because every renderer of localized content has one, and a
 * block that varies its own output by language should not have to reach past
 * this interface to find out which.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export interface BlockRenderContext {
  /** The locale being rendered, when the renderer is rendering one. */
  locale?: string;
}

/**
 * What a block's `render` receives.
 *
 * The engine's own version leaves both the context and the output unnamed,
 * because the engine serves any renderer and cannot know either. This one names
 * both: the context is what THIS app's renderer provides, which is what lets a
 * block read `ctx.data` with no type written by hand, and the output is React,
 * which is what lets a block place a slot straight into its JSX instead of
 * asserting a type over it.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export interface BlockRenderArgs<P>
  extends Omit<EngineBlockRenderArgs<P, BlockRenderContext>, "renderSlot"> {
  /**
   * Render one of this block's slots, optionally under a different context.
   *
   * A promise is a legal child of a server component, which is what makes a
   * block whose slot holds an async block work: the slot is drawn and whatever
   * it returns is placed, with no awaiting for the author to remember.
   */
  renderSlot(this: void, name: string, ctx?: BlockRenderContext): ReactNode;
}

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
export interface BlockDefinition<P extends object = Record<string, unknown>>
  extends Omit<
    EngineBlockDefinition<P, BlockRenderContext>,
    "supports" | "render"
  > {
  supports?: BlockSupports;
  /** Renders the block. May be async. */
  render(args: BlockRenderArgs<P>): ReactNode;
}

/**
 * Declare a block.
 *
 * Returns its argument. It exists to infer the prop type from what is written
 * and to check the rest against the definition shape, which is what makes a
 * mistyped prop name or an unknown support key a compile error rather than a
 * boot one.
 *
 * There is deliberately no per-block context parameter. What a renderer
 * provides is one description per app, and a block that needs something unusual
 * declares it on `BlockRenderContext` where the whole app can see it. A block
 * naming its own context would be asserting privately that it will be handed
 * something, which nothing checks and no registry can honour.
 *
 * @experimental The block API is frozen at the end of the engine phase, not
 *   now. Until then a contributed block may need changes when the definition
 *   shape settles.
 */
export function defineBlock<P extends object>(
  definition: BlockDefinition<P>
): BlockDefinition<P> {
  return definition;
}

/**
 * Supports settings meant to be shared between blocks.
 *
 * Written straight into a definition, a typo is caught: TypeScript checks a
 * literal for keys the target does not declare. Lifted into a variable first,
 * it is not, because that check applies only where the literal is written. This
 * puts the check back at the declaration, which is where the settings are.
 *
 * ```ts
 * const layoutSupports = blockSupports({ spacing: true, layout: true });
 * defineBlock<MyProps>({ …, supports: layoutSupports });
 * ```
 *
 * `satisfies BlockSupports` does the same thing and needs nothing from this
 * package; the helper exists because it reads as the obvious move and cannot be
 * forgotten halfway through.
 *
 * It cannot live on `defineBlock` itself: catching this needs the supplied
 * object's own keys inferred, and TypeScript infers nothing once any type
 * argument is written by hand, so `defineBlock<MyProps>` — the form nearly
 * every block uses — would stop checking anything at all.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export function blockSupports<S extends BlockSupports>(
  supports: ExactSupports<S>
): BlockSupports {
  return supports;
}

/**
 * @experimental Carried by the same freeze as `defineBlock`: these describe the
 *   definition shape, so they change with it.
 */
export type {
  AnyBlockDefinition,
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
