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
import type { BlockNode, BlockPart, NodeStyles } from "./document";
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
  /**
   * Whether an editor may let an author type this value directly on the canvas.
   *
   * Opt-in per prop, and it is a claim about the PROP rather than about the
   * block: a quote's quoted text is edited in place, while the URL it cites is
   * not, and no block-level flag can say that. Named after the same opt-in in
   * Puck, whose `contentEditable` is likewise declared per field.
   *
   * Declaring it is half of the contract. The other half is the block marking
   * WHICH element carries the value, through `markProp` in
   * {@link BlockRenderArgs} — a prop declared inline whose element is never
   * marked simply is not editable in place, which is the safe direction: the
   * inspector still edits it.
   */
  inline?: boolean;
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
  /**
   * What this slot starts with when its block is first placed.
   *
   * Each entry declares one starting child by TYPE, and a type cannot carry an
   * id. That is the whole point: an expander mints a fresh id per entry per
   * instance, so two parents built from one declaration cannot collide on
   * `duplicate-node-id`. A stored list of NODES has the opposite property —
   * its ids are literal, so the second expansion repeats the first's — which is
   * why this names types rather than holding nodes.
   *
   * A LIST of per-item declarations rather than a type and a count, because the
   * entries must be allowed to differ: an unequal split declares a different
   * width per column, and one shared `props` cannot express that. The uniform
   * case repeats an entry, which costs a few characters and keeps one shape.
   *
   * Order is the order the children are created in. An entry naming a type the
   * expander cannot resolve contributes no child, so an unknown type yields a
   * shorter slot rather than a node the renderer would replace with a
   * placeholder.
   */
  defaultBlock?: readonly { type: string; props?: Record<string, unknown> }[];
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

/**
 * The icon names an editor can draw.
 *
 * CONCEPTS, not the names of any icon library's exports. This list is part of
 * the block contract, and `lucide-react` — what the builder happens to draw
 * with today — is a PEER dependency admitting any `>=0.400.0`, so a host may
 * supply a release in which a given export was renamed or dropped. Naming its
 * exports here would let that break a stored plugin block whose author did
 * nothing wrong, and would freeze the editor's art direction into every block
 * definition ever written. A concept is stable in a way an export is not: the
 * builder can re-skin, or change libraries entirely, without a block file
 * changing.
 *
 * Deliberately small and generic rather than one entry per core block. A
 * per-block list would say nothing a block's own name does not, and would leave
 * a plugin author with nothing to choose from — the point of a vocabulary is
 * that a block nobody has written yet already has a word for what it looks
 * like.
 */
export const BLOCK_ICONS = [
  // Structure
  "section",
  "container",
  "columns",
  "column",
  "card",
  "grid",
  "accordion",
  "panel",
  "tabs",
  "divider",
  "spacer",
  // Content
  "heading",
  "text",
  "list",
  "quote",
  "code",
  "table",
  "link",
  // Media
  "image",
  "gallery",
  "video",
  "audio",
  "embed",
  "map",
  // Interactive and data
  "button",
  "form",
  "search",
  "loop",
  "chart",
  "calendar",
  "user",
  "cart",
  "star",
] as const;

/**
 * A block's icon: one of the concepts above, or a name an editor knows of its
 * own.
 *
 * The `(string & {})` arm keeps autocomplete for the vocabulary while admitting
 * a name only a particular editor can resolve, the same bargain
 * `FieldTypeId` strikes for plugin-contributed field types. An editor that
 * meets a name it cannot draw falls back to a generic mark rather than
 * refusing the block — an unknown icon is a cosmetic gap, and a block missing
 * from the palette over one would be a functional loss out of all proportion.
 */
export type BlockIcon = (typeof BLOCK_ICONS)[number] | (string & {});

/** Editor-only metadata. Never serialized into a document. */
export interface BlockEditorMeta<P extends object = Record<string, unknown>> {
  label?: string;
  /**
   * What the palette and the layers tree draw beside this block's name.
   *
   * Absent is legitimate and stays legitimate: the editor draws its generic
   * mark, which is why no block is required to answer this.
   */
  icon?: BlockIcon;
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
   * The generated class the block MUST place on its own root element.
   *
   * Styles for the block's own element target this. A block that draws more
   * than one element marks the others with {@link partClass} instead — this
   * one names the root and only the root, so two elements never answer to one
   * node's identity.
   */
  className: string;
  /**
   * The class marking one of the elements this block declares in `parts`.
   *
   * Placed on the element the part names: `<figcaption className={partClass("caption")}>`.
   *
   * Supplied by the renderer rather than composed by the block, because the
   * renderer is the only party that already knows which block is rendering. A
   * block building the class itself would have to repeat its own type, and a
   * block that repeated a NEIGHBOUR'S type would silently wear another block's
   * defaults — a mistake nothing could catch, since the result is a valid class
   * that the compiler happily emits rules for.
   *
   * Returns an empty string for a name the block does not declare, so a typo
   * leaves the element unstyled rather than marked with a class no rule
   * targets. Both are inert; only one of them is greppable.
   */
  partClass: (name: string) => string;
  /**
   * Marks the element that carries a named prop's value, for an editor.
   *
   * Spread onto the element the value is rendered into:
   * `<p {...markProp?.("text")}>`. Absent outside an editor, and a renderer
   * that supplies it returns nothing for a prop the block never declared
   * `inline` — so a published page carries none of this and a block written
   * against an older renderer keeps working.
   *
   * ## Why the BLOCK says where its text is
   *
   * Nothing else can. A quote renders three separate text props into three
   * different nested elements, and the structure it chooses depends on which
   * of them are empty; a heading renders its text inside an anchor when it has
   * a link and directly otherwise. An editor inferring the element from the
   * rendered DOM would be guessing, and guessing WRONG puts an author's typing
   * into a different prop than the one they aimed at.
   *
   * The alternative the field is deliberately avoiding is a second render path
   * for editing — the shape Gutenberg takes, where a block writes `edit` and
   * `save` separately and the two must agree. One renderer draws both the
   * canvas and the published page here, and that property is worth more than
   * the convenience of an editor-only component.
   */
  markProp?: (name: string) => Record<string, string>;
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
  /**
   * Elements this block renders INSIDE its root, named so a style can reach
   * one of them.
   *
   * {@link baseStyles} is keyed by block TYPE, so it compiles to one rule on
   * one class. A block that draws more than one element — a figure wrapping an
   * image and a caption, a list wrapping its items — can put that class on the
   * root or on one child and has no third option, so every element but the one
   * holding it is unstyleable. These are the others.
   *
   * NAMED rather than written as selectors at the point of use, so a block may
   * change what it renders without invalidating styles addressed to it: the
   * name is the contract and the selector is the current implementation of it.
   * That is the same trade `::part()` makes, and the reason it is a closed set
   * the block publishes rather than an open selector anyone may write — an open
   * one couples every stored style to markup the block is otherwise free to
   * change.
   */
  parts?: Readonly<Record<string, BlockPart>>;
  /** Named child regions; only container blocks declare these. */
  slots?: Record<string, SlotSpec>;
  /**
   * The only block names this block may be a DIRECT child of. Omitted means
   * anywhere.
   *
   * The child's half of a nesting rule, and the counterpart to `SlotSpec.allow`
   * rather than a restatement of it. A slot's allow-list is the PARENT saying
   * what it will hold; this is the CHILD saying where it makes sense. Neither
   * implies the other: a slot naming a type must not confine that type to it,
   * and a block that is meaningless outside one parent has to say so itself,
   * because no parent can be made to speak for a block it has never heard of.
   *
   * Named after the same field in Gutenberg's block metadata, which reaches the
   * identical split — its `core/column` declares `parent: ["core/columns"]`.
   */
  parent?: readonly string[];
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
  /**
   * What this block contributes to the page's metadata when the entry's own
   * SEO fields are blank.
   *
   * Declared by the BLOCK rather than derived by reading prop names, because
   * only the block knows which of its props is a title and which is body text.
   * A deriver that guessed from names would work for the core library and go
   * silent for every contributed block — the wrong way round, since a page
   * built mostly from third-party blocks is exactly the one with nothing else
   * to fall back on.
   *
   * Pure and synchronous by design. It runs during metadata generation, once
   * per node until each field is filled, so a definition that fetched here
   * would put a network call between a crawler and the page title. An image is
   * returned as a media id or a URL and resolved by the caller, which is what
   * keeps it that way.
   */
  seo?(props: P): BlockSeoContribution | undefined;
  /**
   * Slots this block may decline to render for some props.
   *
   * @internal NOT part of the stable block-authoring surface yet — deliberately
   * absent from `@nextlyhq/plugin-sdk`, because the shape a block author should
   * write is a freeze decision rather than one to settle mid-review. It exists
   * now because a CORE block needs it: `core/collection-loop` draws its children
   * only when a query returns rows, and a reader of the stored document cannot
   * tell whether it did.
   *
   * Consumed by anything deriving page-level facts from a document without
   * rendering it. Such a reader must skip these slots: their contents may not
   * reach the page, and describing a page by content it does not contain
   * publishes that content off-site.
   *
   * This closes the class for the core library only. A contributed block that
   * renders conditionally and declares nothing still contributes, and nothing
   * outside the block can detect that — which is why the general answer is an
   * API question rather than a walk question.
   */
  conditionalSlots?: readonly string[];
  /** Editor-only metadata; never serialized. */
  editor?: BlockEditorMeta<P>;
}

/**
 * A block's offer toward the page's metadata.
 *
 * Every field optional and independent: a heading knows a title and nothing
 * else, an image knows a picture and nothing else, and the deriver fills each
 * from the first block that answers for it.
 */
export interface BlockSeoContribution {
  /** Page title, e.g. a heading's text. */
  title?: string;
  /** Description text, e.g. the opening paragraph. */
  description?: string;
  /**
   * Where the page's picture may come from, best first.
   *
   * A list because a block can hold more than one answer and they are not
   * equally good: an image block carries a media id AND a directly-typed URL,
   * renders the resolved media when it can and falls back to the URL when it
   * cannot. Offering only the first makes a link preview disagree with the
   * page whenever the media record is missing; offering only the last ignores
   * the resolved one.
   */
  image?: BlockSeoImage | readonly BlockSeoImage[];
}

/**
 * One place a page's picture may come from, saying WHICH KIND it is.
 *
 * Tagged rather than left as a bare string, because the kind cannot be
 * recovered from the text. A media id is a UUID and a URL is anything a
 * renderer will accept as a source — which includes a bare word, a relative
 * path, and a UUID. Every predicate that tried to tell them apart was wrong
 * about some value a block renders perfectly well: it sent a renderable source
 * to a media lookup that missed, or passed a real id through unresolved.
 *
 * The block already knows, because it read the value out of a `mediaId` prop or
 * a `src` prop. Saying so costs nothing and removes the guess entirely.
 *
 * A plain string means a URL — the safe reading, since a wrong URL renders a
 * broken image while a wrong media lookup silently drops the picture.
 */
export type BlockSeoImage = string | { media: string } | { url: string };

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
    | "seo"
  > {
  example: { props: object; slots?: Record<string, BlockNode[]> };
  defaultProps?: object;
  props?: Partial<Record<string, PropSchema>>;
  localized?: string[];
  render(args: BlockRenderArgs<object, unknown>): BlockRenderResult;
  rendersNothing?(this: void, props: object): boolean;
  /**
   * Widened for the same reason as the members above, and it was the one member
   * that was missed.
   *
   * Inherited unwidened, `seo` kept `BlockDefinition`'s default prop type, so a
   * definition built by `defineBlock<CardProps>` carried
   * `(props: CardProps) => ...` against this type's
   * `(props: Record<string, unknown>) => ...`. Neither direction is assignable —
   * an interface without an index signature is not a `Record<string, unknown>`,
   * and a `Record<string, unknown>` is not a `CardProps` — so bivariance had
   * nothing to fall back on, and EVERY typed definition was rejected by
   * `registerBlocks` whether or not it contributed any SEO at all.
   */
  seo?(props: object): BlockSeoContribution | undefined;
}
