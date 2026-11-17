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
 * layout the page builder's copy is not reachable from their package. Nothing
 * here reads or writes a registry: a plugin's blocks reach a site through the
 * page builder (`contributes.declarations`, or its `blocks` service), which
 * holds that site's registry.
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

import type { AuthenticatedScope, AuthUser } from "./index";

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
  /** Border lines, corner rounding and the outline. */
  border: "line" | "radius" | "outline";
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
  /** The icon a block's disclosure children show, and which side it sits on. */
  disclosure: never;
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
   * into its own JSX, and that union is not a legal child. React admits only
   * `Promise<AwaitedReactNode>`, a promise of a settled node, so a promise that
   * may itself yield a promise is refused. Widening here would move the error
   * onto every block that draws a slot.
   *
   * It still admits a pending slot, because React counts
   * `Promise<AwaitedReactNode>` as a `ReactNode`: a renderer may hand one back
   * and the block places it unchanged.
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
   * The promise is spelled out rather than left to `ReactNode`, which admits
   * only a promise of a settled node: an async block's `render` returns a
   * promise of anything it could return synchronously, and spelling it out
   * says so.
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
 *   definition shape, so they change with it. `PropGroup` and
 *   `StyleSectionKey` are added deliberately, as experimental, for the
 *   `group` and `section` hints a prop already carries through `PropSchema`.
 */
export type {
  AnyBlockDefinition,
  InferBlockProps,
  PropGroup,
  PropSchema,
  StyleSectionKey,
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
 * The promise is spelled out for the same reason `render` spells it out.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export type BlockRenderResult = ReactNode | Promise<ReactNode>;

/**
 * What a block's own inspector (`editor.component`) is given: the selected
 * node, its props, `commit(name, value)` through the editor's own write path,
 * and whether the block is read-only. The editor refuses a commit while it is,
 * and one to a non-content prop inside a `contentOnly` area, whatever the
 * component does.
 *
 * @experimental The contract will grow with the editor's controls registry.
 */
export type { BlockInspectorProps } from "@nextlyhq/blocks-engine";

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
 * `ContentKind` and `ContentModel` are what `contentModel(props)` answers
 * with, so a block author declares what their block is as HTML content
 * without importing the engine.
 *
 * @experimental Carried by the same freeze as `defineBlock`.
 */
export type {
  BlockEditorMeta,
  BlockExample,
  BlockIcon,
  BlockIsland,
  BlockPart,
  BlockSeoContribution,
  BlockSeoImage,
  BlockVariation,
  ComponentPath,
  ContentKind,
  ContentModel,
  NodeStyles,
  SlotLock,
  SlotSpec,
} from "@nextlyhq/blocks-engine";

/**
 * Named queries: a collection list's custom source. A developer declares one
 * with `defineNamedQuery`, its typed inputs made with `param`, every
 * collection, Single and site setting it reads, and the shape of its rows.
 * The site registers its own with `pageBuilder({ namedQueries })`; a plugin
 * declares them under `contributes.declarations["@nextlyhq/plugin-page-builder"].namedQueries`.
 *
 * Re-exported from the engine, where the validator and the renderer read the
 * same declaration. Its `run` function receives a reader that reads as an
 * anonymous visitor, limited to what the query declares; the Direct API
 * refuses any other read made while it runs.
 *
 * @experimental A collection list's custom source settles with the editor
 * that offers it.
 */
// From the engine's narrow entry, not its root: a plugin importing this module
// would otherwise bring the whole engine and its CSS parser to every admin
// screen. The same module the root re-exports, so one registry either way.
export { defineNamedQuery, param } from "@nextlyhq/blocks-engine/named-query";
/** @experimental Settles with `defineNamedQuery`. */
export type {
  BooleanParam,
  ChoiceParam,
  DayParam,
  EntryParam,
  NamedQueryChoice,
  NamedQueryDeclaration,
  NamedQueryDefinition,
  NamedQueryParam,
  NamedQueryParams,
  NamedQueryParamValues,
  NamedQueryReader,
  NamedQueryResult,
  NamedQueryRows,
  NamedQueryRunArgs,
  NamedReadFilter,
  NamedReadQuery,
  NumberParam,
  TextParam,
} from "@nextlyhq/blocks-engine";

// ---------------------------------------------------------------------------
// Form providers
// ---------------------------------------------------------------------------

/**
 * The controls a described form field may be drawn as: plain HTML controls,
 * so the Form block draws every provider's form with the same markup and the
 * same style parts.
 *
 * @experimental The form provider contract is new; its names and shape may
 *   change until the forms plugin and one outside provider have used it.
 */
export type FormFieldKind =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "url"
  | "date"
  | "time"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "hidden";

/**
 * One choice of a `select`, `radio` or `checkbox` field.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export interface FormFieldOption {
  /** What is sent when it is chosen. */
  readonly value: string;
  /** What a visitor reads. */
  readonly label: string;
}

/**
 * One field of a described form, in a neutral shape the Form block draws.
 *
 * @experimental Carried by the form provider contract's freeze. A new field
 *   feature needs a change here, which is why the contract stays experimental.
 */
export interface FormFieldDescription {
  /** The name its answer is sent under; unique within the form. */
  readonly name: string;
  /** What its label says. */
  readonly label: string;
  /** Which control is drawn. */
  readonly kind: FormFieldKind;
  /** Whether an empty answer is refused. */
  readonly required?: boolean;
  /** A line of help under the control. */
  readonly help?: string;
  /** Example text shown in an empty control. */
  readonly placeholder?: string;
  /** The choices of a `select`, `radio` or `checkbox` field. */
  readonly options?: readonly FormFieldOption[];
  /** The file types a `file` field takes, as the `accept` attribute. */
  readonly accept?: string;
  /** The smallest number or earliest date accepted. */
  readonly min?: number;
  /** The largest number or latest date accepted. */
  readonly max?: number;
  /** A pattern the answer must match, as the `pattern` attribute. */
  readonly pattern?: string;
  /**
   * Opaque values the provider's own script reads (drawn as `data-*`), such
   * as a conditional field's condition. The page builder never reads them.
   */
  readonly provider?: Readonly<Record<string, string>>;
}

/**
 * What a visitor sees once a send is accepted: a message in place of the
 * form, or another page of the same site.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export type FormAfterSending =
  | { readonly kind: "message"; readonly message: string }
  | {
      readonly kind: "page";
      /** A path of the same site; anything else sends the visitor back to the form's page. */
      readonly href: string;
    };

/**
 * A form as its provider describes it, for the Form block to draw.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export interface FormDescription {
  /** The provider's own reference to the form, as stored in a block. */
  readonly ref: string;
  readonly title: string;
  /** In display order. */
  readonly fields: readonly FormFieldDescription[];
  readonly submitText: string;
  /** The form's own setting; a block may choose another. */
  readonly afterSending: FormAfterSending;
  /** How the browser sends it: `multipart` when a field takes a file. */
  readonly encoding: "urlencoded" | "multipart";
  /**
   * A module the provider needs on pages drawing this form (a bot check's
   * widget, say), and why. The page builder adds it only to those pages.
   */
  readonly script?: { readonly module: string; readonly reason: string };
}

/**
 * Why a provider has no form to describe: it exists and takes no answers
 * now (`closed`), or there is none by that reference for this reader
 * (`missing`).
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export interface FormUnavailable {
  readonly unavailable: "closed" | "missing";
  /** What a visitor reads in place of a closed form, as its author wrote it. */
  readonly message?: string;
}

/**
 * One form a provider lists for an author to pick.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export interface FormListing {
  readonly ref: string;
  readonly title: string;
  readonly state: "draft" | "published" | "closed";
  /** Where the author edits it in the admin. */
  readonly editHref?: string;
}

/**
 * Whom a provider reads a form as. Handed straight to `ctx.services` as its
 * options: `public` is an anonymous visitor, with every access rule applied;
 * `user` is a signed-in author, with their own rights.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export type FormAccess =
  | { readonly as: "public" }
  | {
      readonly as: "user";
      readonly user: AuthUser;
      readonly authenticatedScope?: AuthenticatedScope;
    };

/**
 * A post's answers, by field name, each with every value sent under it.
 * Only the fields the form describes reach a provider: the receiver trims
 * every other name, its own hidden fields among them.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export type FormAnswers = ReadonlyMap<string, readonly string[]>;

/**
 * One post, as the page builder's receiver hands it to the provider.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export interface FormPost {
  readonly answers: FormAnswers;
  /** The language of the page the form was sent from, when the site has several. */
  readonly locale?: string;
  /**
   * The visitor's request, for the provider's own checks: its client address
   * for a rate limit, its headers for a bot check. Its body is already read.
   */
  readonly request: Request;
}

/**
 * What became of a post, as the provider says.
 *
 * - `sent`: accepted. `afterSending` overrides the form's own setting.
 * - `invalid`: answers refused, each with the field it names.
 * - `closed`: the form takes no answers now.
 * - `failed`: anything else; the visitor is asked to try again.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export type FormAcceptResult =
  | { readonly kind: "sent"; readonly afterSending?: FormAfterSending }
  | {
      readonly kind: "invalid";
      readonly issues: readonly {
        readonly field: string;
        readonly message: string;
      }[];
    }
  | { readonly kind: "closed"; readonly message?: string }
  | { readonly kind: "failed" };

/**
 * A source of forms the Form block can draw and the page builder's receiver
 * hands posts to, such as the forms plugin.
 *
 * Every rule about a provider's forms — which exist, how answers are
 * checked, stored and sent, spam checks beyond the receiver's own — stays in
 * the provider. The page builder draws what `describe` gives and passes on
 * what a visitor sent; it knows nothing else about a provider's forms.
 *
 * Registered from the provider plugin's `init` through the page builder's
 * cross-plugin `forms` service ({@link FormProviderService}).
 *
 * @experimental The form provider contract is new; its names and shape may
 *   change until the forms plugin and one outside provider have used it.
 */
export interface FormProvider {
  /**
   * Stable, and stored in every block that picks one of its forms: lower
   * case letters, digits and `-`, 1 to 64 characters. `simple` is the page
   * builder's own and cannot be registered.
   */
  readonly id: string;
  /** What authors read: "Forms" in "Fields … come from Forms." */
  readonly label: string;
  /** The forms an author may pick, read with the author's own rights. */
  list(access: FormAccess): Promise<readonly FormListing[]>;
  /**
   * One form, for the live page (as the public: published and open forms
   * only) and for the canvas (as the author).
   */
  describe(
    ref: string,
    options: { readonly access: FormAccess; readonly locale?: string }
  ): Promise<FormDescription | FormUnavailable>;
  /**
   * Take one post. Called by the receiver in the same process, after its own
   * spam trap, size limits and field trim; the provider applies every rule of
   * its own.
   */
  accept(ref: string, post: FormPost): Promise<FormAcceptResult>;
}

/**
 * The page builder's cross-plugin `forms` service, as a provider plugin
 * reaches it: `ctx.services.plugins["@nextlyhq/plugin-page-builder"].forms`.
 * Resolve it from `init`. Registering an `id` already registered throws.
 *
 * @experimental Carried by the form provider contract's freeze.
 */
export interface FormProviderService {
  register(provider: FormProvider): void;
}
