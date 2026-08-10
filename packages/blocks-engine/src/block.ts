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
 * Style capabilities a block opts into. Each key must be a registered support
 * (built-in or added via `registerSupport`); `true` enables the whole group and
 * an object enables individual sub-flags.
 *
 * Open at this level because the registry holds blocks from every source and
 * validates their keys against what is registered at boot. The AUTHORING type
 * is narrower and lives in `@nextlyhq/plugin-sdk/blocks`, where a plugin author
 * can reach it: an augmentation has to name a module that resolves from the
 * augmenting file, and a plugin installs the SDK rather than this package.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export type BlockSupports = Record<string, BlockSupportValue>;

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
  /**
   * The generated class the block MUST place on its own root element. Blocks
   * render a single element and never wrap it, so styles target that element.
   */
  className: string;
  /**
   * Render one of this block's slots, optionally under a different context.
   *
   * A function rather than a map of already-rendered children, and the
   * difference is what a block can express. Handed finished output, a block can
   * only place it, so a repeater stamps the same picture once per entry and no
   * child inside it can show its own entry's fields. Handed the means to draw,
   * a repeater draws its template once per entry, each time saying which entry
   * this one is for.
   *
   * The gain is not only repeaters. Nothing is rendered until it is asked for,
   * so a Tabs block draws the visible panel and not the three behind it, and a
   * panel that is never shown never runs the queries inside it.
   *
   * Passing a context replaces the block's own for that subtree; omitting it
   * keeps the block's. What a context CONTAINS is the renderer's to say, which
   * is why the item a repeater is iterating is named there rather than here.
   *
   * Named after the same idea in Vue (scoped slots) and Svelte (snippets): a
   * region the parent supplies and the child draws, with values passed in at
   * the moment of drawing.
   *
   * Declared `this: void`, which says what is true: it reads nothing from the
   * object it arrives on. That is what lets a block pull it out of these
   * arguments and call it, which is how every block is written. A plain
   * function-typed property would say the same thing but make the arguments
   * contravariant in the context, and a registry holding blocks of many context
   * types could then hold none of them.
   */
  renderSlot(this: void, name: string, ctx?: C): BlockRenderResult;
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
  /**
   * Whether these props guarantee the block draws nothing, decided WITHOUT
   * rendering.
   *
   * A block that draws nothing still costs a reader something: the stylesheet
   * carries its rules, and a rule may name a URL, so an empty block can make a
   * request on behalf of markup that never appears. A renderer can already tell
   * that an unregistered or un-upgradable node will not draw, but only the block
   * knows that `core/image` with no source is the same case.
   *
   * Answering is optional, and a block that does not is assumed to draw. That
   * is the safe default in the expensive direction: shipping unused rules wastes
   * bytes, while withholding the rules of a block that DOES draw ships it
   * unstyled, which is a visibly broken page.
   *
   * Must be PURE and SYNCHRONOUS. It is consulted before any render, on the
   * stored props alone, at a point where no context, no data access and no
   * awaiting exist. A caller treats a thrown or non-boolean answer as "draws",
   * so a mistake here degrades to the current behaviour rather than to a
   * missing stylesheet.
   *
   * Declared `this: void` for the same reason `renderSlot` is: it reads nothing
   * from the definition it arrives on, and saying so is what lets a caller pull
   * it out and call it without binding. Kept as a METHOD signature so parameter
   * checking stays bivariant, which is what allows a definition typed against
   * its own props to sit in a registry of many prop shapes.
   */
  rendersNothing?(this: void, props: P): boolean;
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
 * still call `render` with that node's runtime props. Narrowing them
 * to `never` would make the collection accept definitions it could never use.
 *
 * @experimental Re-exported to plugin authors as `@nextlyhq/plugin-sdk/blocks`.
 *   Settles at the end of the engine phase.
 */
export interface AnyBlockDefinition
  extends Omit<
    BlockDefinition,
    | "example"
    | "defaultProps"
    | "props"
    | "localized"
    | "render"
    | "rendersNothing"
  > {
  example: { props: object; slots?: Record<string, BlockNode[]> };
  defaultProps?: object;
  props?: Partial<Record<string, PropSchema>>;
  localized?: string[];
  render(args: BlockRenderArgs<object, unknown>): BlockRenderResult;
  rendersNothing?(this: void, props: object): boolean;
}
