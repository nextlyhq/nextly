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
 *     animation: "enter" | "exit";
 *     parallax: true;
 *   }
 * }
 * ```
 *
 * Declaration merging rather than an index signature: an index signature accepts
 * every key, which is what leaves a misspelled `spaceing` to be found at boot,
 * in someone else's app, instead of while it is being written.
 *
 * One rule reads the value: a union of strings names the sub-flags the support
 * recognises, and anything else means the support is all-or-nothing. So a nested
 * typo is caught in the same breath as a top-level one — `{ spacing: { paddding:
 * true } }` enables nothing at all, and finding that out at boot is exactly what
 * this exists to prevent — while a support with no finer granularity can be
 * written the way it reads, as `never` or as `true`.
 *
 * The built-in keys are the style catalog's groups plus the capabilities that
 * have no catalog group of their own. A test holds both the keys and their
 * flags to what the registry actually accepts, so the two cannot drift.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export interface BlockSupportKeys {
  /** Padding and margin. */
  spacing: "margin" | "padding";
  /** Flow, alignment and gap. */
  layout: never;
  /** Width, height and their limits. */
  dimensions: never;
  /** Font, size, weight, line height and letter spacing. */
  typography: never;
  /** Text and link colours. */
  color: "text" | "link";
  /** Background colour, image and gradient. */
  background: "color" | "image" | "gradient";
  /** Border lines and corner rounding. */
  border: "line" | "radius";
  /** Box and text shadows. */
  shadow: never;
  /** Opacity, filters and transforms. */
  effects: never;
  /** Positioning and stacking. */
  position: never;
  /** Container-query behaviour. */
  container: never;
  /** Marker style on a list. */
  list: never;
  /** Author-written CSS on this block. Gates a capability, not a style group. */
  customCss: never;
}

/**
 * What one support key accepts, given the sub-flags it declares.
 *
 * The two cases are kept apart rather than both handed to `Record`, because
 * `Record` demands a property key and a support that declares no flags has none
 * to give. Feeding it either sentinel is unsound in opposite directions: `true`
 * is not a property key at all, so the mapped type stops instantiating and an
 * augmenting plugin's build fails on the declaration rather than on anything it
 * wrote; `never` produces `Partial<Record<never, boolean>>`, which is `{}`, and
 * `{}` accepts every object — so `{ layout: { typo: true } }` type-checks and is
 * refused only later, by the registry, at boot.
 *
 * `[F] extends [never]` is asked first and in tuple form. Bare `F extends never`
 * distributes and answers for the empty union rather than about it, and
 * `[never] extends [string]` is true, so a `never` reaching the string case
 * would rebuild the same `{}`.
 */
type SupportSetting<F> = [F] extends [never]
  ? boolean
  : [F] extends [string]
    ? boolean | Partial<Record<F & string, boolean>>
    : boolean;

/**
 * Style capabilities a block opts into: `true` for a whole group, or an object
 * naming the sub-flags it wants.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export type BlockSupports = {
  [K in keyof BlockSupportKeys]?: SupportSetting<BlockSupportKeys[K]>;
};

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
   * `ReactNode` rather than the `ReactNode | Promise<ReactNode>` that `render`
   * returns, and the asymmetry is deliberate: this value is one a block places
   * into its own JSX, and that union is not a legal child under EITHER supported
   * peer. React 18 admits no promise at all; React 19 admits only
   * `Promise<AwaitedReactNode>`, a promise of a settled node, so a promise that
   * may itself yield a promise is refused there too. Widening here would move
   * the error onto every block that draws a slot.
   *
   * It still says what each peer can express, because React 19 counts
   * `Promise<AwaitedReactNode>` as a `ReactNode`: a renderer on 19 may hand back
   * a pending slot and the block places it unchanged. On 18 it may not, which
   * costs nothing, since an async block cannot be drawn under React 18's types
   * regardless — `<AsyncBlock />` is refused outright there.
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
    // `conditionalSlots` is withheld ON PURPOSE. It exists because a core block
    // needs it, and what a block author should write is a Block API freeze
    // decision — but an `@internal` tag removes nothing from a published type,
    // and this `Omit` inherits every property it does not name. Reserving it
    // takes naming it here; anything less lets a plugin compile against a
    // provisional shape and be broken when the freeze settles it.
    "supports" | "render" | "conditionalSlots"
  > {
  supports?: BlockSupports;
  /**
   * Renders the block.
   *
   * The promise is spelled out rather than left to `ReactNode`. React 19 added
   * promises to that type and React 18 did not, and this package supports both,
   * so an async block would compile against one peer and be rejected by the
   * other. Naming it here makes the async contract mean the same thing across
   * the range this package declares.
   */
  render(args: BlockRenderArgs<P>): BlockRenderResult;
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
  InferBlockProps,
  PropSchema,
  SupportDefinition,
} from "@nextlyhq/blocks-engine";

/**
 * What a block's `render` returns.
 *
 * Declared here rather than re-exported. The engine's own is `unknown`, because
 * the engine serves any renderer and cannot name an output type; naming it there
 * would tie a runtime-free package to React. That leaves the re-exported name
 * useless for the thing an author would reach for it to do — a helper typed
 * `(args: BlockRenderArgs<P>) => BlockRenderResult` returns `unknown`, which does
 * not satisfy `BlockDefinition["render"]`, so handing that helper to
 * `defineBlock` failed to compile.
 *
 * The promise is spelled out for the same reason `render` spells it out: React
 * 19 added promises to `ReactNode` and React 18 did not, and this package
 * supports both.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export type BlockRenderResult = ReactNode | Promise<ReactNode>;

/**
 * The rest of the definition's own vocabulary. Every one of these names a field
 * a block author fills in, so leaving them off this surface meant writing a slot
 * template, an example, or an editor entry against a type that could only be
 * reached by importing the engine directly — which is the one thing this subpath
 * exists to make unnecessary.
 *
 * `BlockSupportValue` is deliberately NOT among them. The engine's is
 * `boolean | Record<string, boolean>`, which is what its registry stores from
 * every source; offered here as authoring vocabulary it would undo the check
 * this module exists for, since `const spacing: BlockSupportValue = { paddding:
 * true }` accepts the typo the per-key flag unions refuse. A shared setting for
 * one key is written as `BlockSupports["spacing"]`, which is checked, and a
 * whole object goes through `blockSupports()`.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export type {
  BlockEditorMeta,
  BlockExample,
  BlockIcon,
  BlockSeoContribution,
  BlockSeoImage,
  BlockVariation,
  ComponentPath,
  NodeStyles,
  SlotLock,
  SlotSpec,
} from "@nextlyhq/blocks-engine";
