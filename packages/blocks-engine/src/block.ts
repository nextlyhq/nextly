/**
 * The block definition API. `defineBlock` describes one block type: its schema
 * version and upgrade steps, the props it accepts, the slots it nests children
 * in, the style capabilities it opts into, how it renders, and the metadata an
 * editor needs.
 *
 * Framework-agnostic by construction. The engine stores definitions (including
 * their `render` function) but never calls a UI library itself, so `render`'s
 * return type is opaque here and narrowed by the React binding package. That is
 * what keeps this package dependency-free and usable from any runtime.
 */
import type { BlockNode, NodeStyles } from "./document";
import type { MigrationMap } from "./migration";

/**
 * A prop's schema entry. Structural on purpose: the engine only needs each
 * prop's declared `type` (for the generated manifest and for deriving editor
 * controls); the full field-configuration vocabulary lives in the field system
 * that produces these objects.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export interface PropSchema {
  type: string;
  [option: string]: unknown;
}

/** How much of a slot is locked against editing. */
export type SlotLock = "all" | "insert" | "contentOnly" | false;

/** One named child region a container block exposes. */
export interface SlotSpec {
  /**
   * Block names allowed in this slot; a trailing `*` matches a namespace
   * (`"core/*"`). Omitted means any block is allowed.
   */
  allow?: string[];
  /** Children inserted when the block is first placed. */
  template?: BlockNode[];
  /**
   * Editing restriction for this slot, inherited by its children:
   * `"all"` locks everything, `"insert"` forbids adding/removing children,
   * `"contentOnly"` allows editing values but not structure.
   */
  lock?: SlotLock;
}

/**
 * What one support declaration may say: on, off, or a set of named sub-flags.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export type BlockSupportValue = boolean | Record<string, boolean>;

/**
 * The support keys a block may declare, as an interface so the vocabulary is
 * open at the type level the same way it is open at runtime.
 *
 * A plugin that calls `registerSupport()` adds its key to the vocabulary the
 * compiler checks against by augmenting this interface:
 *
 * ```ts
 * declare module "@nextlyhq/blocks-engine" {
 *   interface BlockSupportKeys {
 *     animation: true;
 *   }
 * }
 * ```
 *
 * Declaration merging rather than an index signature: an index signature would
 * accept every key, which is what leaves a misspelled `spaceing` to be caught at
 * boot instead of while it is being written.
 *
 * The built-in keys are the style catalog's groups. They are written out rather
 * than mapped from `StyleGroup` so each can carry the sub-flags it recognises in
 * its own doc comment, and a type test asserts these keys are exactly
 * `StyleGroup`, so the two lists fail to compile rather than drifting.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export interface BlockSupportKeys {
  /** Padding and margin. Flags: `padding`, `margin`. */
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
  /** Border lines and corner rounding. Flags include `radius`. */
  border: true;
  /** Box and text shadows. */
  shadow: true;
  /** Opacity, filters and transforms. */
  effects: true;
  /** Positioning and stacking. */
  position: true;
  /** Container-query behaviour. */
  container: true;
}

/**
 * Style capabilities a block opts into. Each key must be a registered support
 * (built-in or added via `registerSupport`); `true` enables the whole group and
 * an object enables individual sub-flags.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export type BlockSupports = Partial<
  Record<keyof BlockSupportKeys, BlockSupportValue>
>;

/** A path to an editor component, resolved through the admin import map. */
export type ComponentPath = string;

/** Editor-only metadata. Never serialized into a document. */
export interface BlockEditorMeta<P extends object = Record<string, unknown>> {
  label?: string;
  icon?: string;
  /** Palette grouping, e.g. "structure" | "content" | "media". */
  category?: string;
  /** Extra search terms for the block palette. */
  keywords?: string[];
  /** Named preset variations offered when inserting. */
  variations?: BlockVariation<P>[];
  /** Custom inspector/canvas component for this block. */
  component?: ComponentPath;
}

/**
 * A named preset for inserting a block. Its props are typed against the
 * block's own props, so a preset cannot introduce a value the renderer does
 * not accept.
 */
export interface BlockVariation<P extends object = Record<string, unknown>> {
  name: string;
  label?: string;
  props?: Partial<P>;
}

/**
 * What a block's `render` receives.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export interface BlockRenderArgs<P, C = unknown> {
  props: P;
  node: BlockNode;
  /** Rendered children per slot, keyed by slot name. */
  slots: Record<string, unknown>;
  /**
   * The generated class the block MUST place on its own root element. Blocks
   * render a single element and never wrap it, so styles target that element.
   */
  className: string;
  /**
   * Whatever the renderer makes available to a block: a data source, the
   * current locale, a request. Its type is the renderer's to name, not this
   * package's — the engine stays free of both React and any renderer, so it
   * carries the handle without knowing what is on the other end.
   *
   * A block that reads data declares the context it needs
   * (`BlockRenderArgs<MyProps, PageContext>`) and gets it typed. Without this
   * an async block has no way to reach anything, which makes a dynamic block
   * unwritable however many other members the definition has.
   */
  ctx: C;
}

/**
 * A block's rendered output. Opaque here: the engine stores and passes it
 * through without inspecting it, so this package needs no UI dependency.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export type BlockRenderResult = unknown;

/** An example instance, required so tooling and agents have a worked sample. */
export interface BlockExample<P> {
  props: P;
  slots?: Record<string, BlockNode[]>;
}

/**
 * One block type.
 *
 * `P` is constrained to `object` rather than a string-index record so ordinary
 * named interfaces (which carry no implicit index signature) can describe a
 * block's props without being rewritten.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export interface BlockDefinition<
  P extends object = Record<string, unknown>,
  C = unknown,
> {
  /** Namespaced, immutable identity, e.g. "core/heading". */
  name: string;
  /** Schema version stamped onto every node of this type. */
  version: number;
  /**
   * Upgrade steps keyed by from-version. A version above 1 requires steps
   * covering every version below it; registration refuses an uncovered bump.
   */
  migrate?: MigrationMap;
  /** Required: what the block is, for docs, the palette, and agents. */
  description: string;
  /** Required: a worked instance, for previews and few-shot prompting. */
  example: BlockExample<P>;
  /**
   * Prop schemas, keyed by the block's own prop names so a typo cannot declare
   * a schema for a prop the block does not have.
   */
  props?: Partial<Record<keyof P & string, PropSchema>>;
  /** Default prop values; also the inference source for the block's prop type. */
  defaultProps?: P;
  /** Prop names whose values are translatable. */
  localized?: (keyof P & string)[];
  /** Shared default styles for every instance of this block type. */
  baseStyles?: NodeStyles;
  /** Named child regions; only container blocks declare these. */
  slots?: Record<string, SlotSpec>;
  /** Style capabilities this block opts into. */
  supports?: BlockSupports;
  /**
   * Renders the block. May be async.
   *
   * Declared as a method so parameter checking stays bivariant: a registry
   * holds definitions of many different prop shapes, and each is only ever
   * called with its own props, so requiring strict contravariance here would
   * make a typed definition unassignable to the heterogeneous collection
   * without buying any safety.
   */
  render(args: BlockRenderArgs<P, C>): BlockRenderResult;
  /** Optional editor-side data hydration before rendering. */
  resolve?(props: P, ctx: unknown): unknown;
  /** Editor-only metadata; never serialized. */
  editor?: BlockEditorMeta<P>;
}

/**
 * Declare a block type. Returns the definition unchanged — its job is to bind
 * the prop type once so `props`, `example`, `defaultProps`, and `render` are
 * checked against each other at author time. Shape rules that need runtime
 * data (name format, version/migration coverage, support keys) are enforced
 * when the block is registered.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   The definition shape settles at the end of the engine phase, so a
 *   contributed block may need changes until then. The tag lives here because
 *   this declaration is what an author's editor resolves to; the SDK's own
 *   re-export is collapsed to one line by its declaration bundler, which drops
 *   the comments attached to it.
 */
export function defineBlock<P extends object, C = unknown>(
  definition: BlockDefinition<P, C>
): BlockDefinition<P, C> {
  return definition;
}

/**
 * The prop type of a block definition.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export type InferBlockProps<D> = D extends BlockDefinition<infer P> ? P : never;

/**
 * A block definition with its prop typing erased.
 *
 * `BlockDefinition<P>` uses `P` both to produce values (`example`,
 * `defaultProps`) and to consume them (`render`), so it is invariant in `P` —
 * `BlockDefinition<{ text: string }>` is deliberately NOT assignable to
 * `BlockDefinition<Record<string, unknown>>`. Collections that hold many block
 * types (the registry above all) accept this erased shape instead, so a fully
 * typed definition can be registered without discarding its prop types at the
 * definition site.
 *
 * The prop-consuming members widen to `object` and are declared as methods, so
 * this type works in both directions: any typed definition is assignable to it
 * (bivariant parameter checking), and a consumer holding a stored node can
 * still call `render`/`resolve` with that node's runtime props. Narrowing them
 * to `never` would make the collection accept definitions it could never use.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export interface AnyBlockDefinition
  extends Omit<
    BlockDefinition,
    "example" | "defaultProps" | "props" | "localized" | "render" | "resolve"
  > {
  example: { props: object; slots?: Record<string, BlockNode[]> };
  defaultProps?: object;
  props?: Partial<Record<string, PropSchema>>;
  localized?: string[];
  render(args: BlockRenderArgs<object, unknown>): BlockRenderResult;
  resolve?(props: object, ctx: unknown): unknown;
}
