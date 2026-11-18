/**
 * What a page compile is given and what it returns: the compile context a
 * caller loads, the compiled stylesheet and its report, and a named class's
 * id and slug as the compiler reads them.
 *
 * @module style/compile-page-context
 */
import type {
  BlockNode,
  BlockPart,
  BreakpointSet,
  NodeStyles,
  StyleValue,
} from "../document";
import type { DocumentLimits } from "../limits";
import type { ValidationIssue } from "../validation";

import type { MayFetchUrl } from "./css-value";
import type { NamedClass } from "./named-class";
import type { ElementBaseKey, SiteTextMap } from "./site-text";
import type { StyleTraceEntry } from "./style-trace";

/** Everything site-level the compiler needs; the caller loads it. */
export interface StyleCompileContext {
  breakpoints: BreakpointSet;
  /**
   * Emit VIEWPORT breakpoints as container queries against this container name,
   * for a surface that shows the page inside a resizable box rather than at the
   * browser's own width.
   *
   * Absent for every published render, and absent is the default: the contexts a
   * caller derives an artifact identity from are then byte-identical to what
   * they were before this existed, so no stored sheet invalidates for CSS that
   * did not change. See `BreakpointContextOptions.previewContainer`, in
   * `compile-page-breakpoints`.
   */
  previewContainer?: string;
  /**
   * Emit each interaction state so a previewing surface can FORCE one on an
   * element, by putting `previewStateClass` (in `compile-page-states`) on it.
   *
   * For an editor, and off by default. A published page has no reason to carry
   * a class nothing will ever set, and a visitor's browser decides its own
   * `:hover`.
   *
   * SEPARATE from `previewContainer` although both describe a preview, because
   * that one is only set when the site defines breakpoints — a site with none
   * would silently get no state preview if this rode on it. Two surfaces can
   * want one without the other.
   *
   * Costs nothing in weight: the marker joins the pseudo-class INSIDE the
   * existing `:where()`, which contributes nothing whatever it holds. That is
   * what lets the preview cascade match the published one exactly, which the
   * style panel's provenance depends on — it explains what a VISITOR gets.
   */
  previewStates?: boolean;
  /**
   * Which hosts this site will fetch from.
   *
   * A stylesheet is a fetching surface: `background-image: url(...)` makes the
   * browser request whatever it names, on every page that rule applies to. The
   * scheme allowlist below the compile refuses `javascript:` and friends but has
   * nothing to say about WHICH http(s) host is reached, and a value carrying no
   * scheme at all can still name one — `//cdn.example/a.png` inherits the page's
   * protocol and nothing else.
   *
   * Left undefined, no host question is asked and the compile behaves exactly as
   * it did before this existed. The engine ships no list of its own because
   * which hosts a site trusts belongs to the site, not to the document format.
   */
  mayFetchUrl?: MayFetchUrl;
  /**
   * What this run's fetch policy IS, for a reader deciding whether a stylesheet
   * compiled earlier may be reused.
   *
   * Only needed when `mayFetchUrl` is supplied directly. A predicate is opaque —
   * nothing can tell one function from another — so a caller that supplies one
   * and wants its compiled sheets cached has to say which policy that function
   * represents. Omit it and a reader treats every stored sheet as compiled under
   * different rules, which is slower and never wrong.
   *
   * The compiler does not read this. It travels with the compile so the answer
   * and the thing it describes cannot be recorded separately and disagree.
   */
  fetchPolicyId?: string;
  /**
   * Base styles per block type, keyed by block name. One shared rule per type
   * rather than a copy inside every node: a page of forty default sections
   * stores no style bytes, resetting a node is deleting its own values, and
   * improving a block's default look reaches pages that already exist.
   */
  blockBases?: Readonly<Record<string, NodeStyles>>;
  /**
   * Base styles for the elements a block renders inside its root, keyed by
   * block name and then by part name.
   *
   * A sibling of {@link blockBases} rather than a richer value inside it,
   * matching how {@link elementBases} and the named-class tier already sit
   * beside it. The two answer different questions — one styles the element the
   * block-type class is ON, the other styles elements it is not — and a block
   * declaring neither, one, or both are all ordinary.
   *
   * The selector travels with the styles because this package holds no
   * registry: it cannot look a part's element up from its name, so the caller
   * that does hold the definitions resolves both together, the same way
   * `drawsNothing` answers from a registry this compiler cannot see.
   */
  blockParts?: Readonly<Record<string, Readonly<Record<string, BlockPart>>>>;

  /**
   * Typographic defaults per HTML element, keyed by tag name.
   *
   * A tier below {@link PageStyleContext.blockBases}, and it exists because a
   * block type cannot express one. A heading's LEVEL is a prop, so every
   * `core/heading` shares one block-type class and one default with it — which
   * would give `h1` and `h3` the same size, the defect rather than the fix.
   * The element is the only thing that distinguishes them.
   *
   * Emitted at zero specificity like block defaults, and BEFORE them, so at
   * equal weight a block's own default wins on source order. Both lose to a
   * named class and to a node's own value.
   *
   * The block library fills it from a site's text (`siteTextElementBases`):
   * the size and line height of each heading level, links and captions, and
   * under the `root` key the page root's Body text, which every block inherits.
   */
  elementBases?: Readonly<Partial<Record<ElementBaseKey, NodeStyles>>>;
  /**
   * The site's text rows, as its token set states them.
   *
   * The compiler does not read this. It travels with the compile for the
   * block library, which derives the element tier from it and lays the
   * Buttons and Captions rows over the blocks that draw a button or a
   * caption, so every compile path is handed one map rather than each
   * deriving its own.
   *
   * @experimental
   */
  siteText?: SiteTextMap;

  /**
   * The space each container block type puts between the blocks in its slots,
   * keyed by block type.
   *
   * A block carries no outer margin of its own; the space between two blocks
   * belongs to the container holding them. In block flow it is a top margin on
   * every child after the first (`> * + *`), so nothing reaches the
   * container's own outer edge; the same value is the container's `gap`, which
   * only a flex or grid container reads. Where a node or a named class makes
   * the container flex or grid, the compiler takes the flow margin off its
   * children at that breakpoint so the two do not add up.
   *
   * Emitted after the block-type tier and before the named classes, at the
   * weight a default carries (`0-1-0`): it beats a child's default margin reset
   * and an element default, and loses to anything an author set on the child
   * (a node value or a named class, both `0-3-0`).
   */
  childGaps?: Readonly<Record<string, StyleValue>>;

  /**
   * Whether a node's block declares that these props draw nothing.
   *
   * A second reason a node's markup never reaches the page, beside a visibility
   * condition, and its rules have to leave the main sheet for the same reason:
   * a stylesheet compiled with them carries whatever they reference — the
   * `url(...)` of an image block still waiting for its picture — for markup
   * nobody is served.
   *
   * A predicate rather than the definitions themselves, because this package
   * has no runtime and does not know what a block is. The caller holds the
   * registry and answers from it; `declaresNoMarkup` in `visibility` is the one
   * implementation, so the compiler and the renderer cannot answer differently
   * about the same node.
   *
   * Left undefined, no such question is asked and the compile behaves exactly
   * as it did before this existed.
   */
  drawsNothing?: (node: BlockNode) => boolean;
  /**
   * The site's named classes, in any order.
   *
   * Emitted between the block-type defaults and each node's own values, which is where a class
   * sits in the cascade: it overrides what a block looks like by default and is overridden by
   * anything the author set on one node. Precedence BETWEEN classes is their library order,
   * carried on the class itself rather than taken from the order a node lists them in, so two
   * nodes with the same classes cannot resolve differently.
   *
   * "In any order" holds up to `MAX_NAMED_CLASSES`. A library longer than that is read as its
   * stored PREFIX, before `orderIndex` is consulted, so which entries survive the cap depends on
   * how they were stored. Ordering first would mean reading the whole array to decide what to
   * drop, which is the read the cap exists to bound — and a library past it is already data no
   * site authored. Callers holding more than the cap should store them in the order they want
   * read.
   */
  namedClasses?: readonly NamedClass[];
  /**
   * The custom-property prefix site tokens are emitted under. Configurable
   * because a site's tokens live in the same namespace as everything else on
   * the page; the reserved prefixes belong to the admin and to Tailwind.
   */
  tokenPrefix?: string;
  /**
   * A class distinguishing this document's rules from another's.
   *
   * Node ids are unique within a document, not across documents, so two
   * documents rendered into one DOM — a page and a region, say — can hold the
   * same id and therefore the same generated class. Without a scope their rules
   * cross-apply and page settings from each reach both roots.
   *
   * Added to the page root rather than replacing it, so the anchored selector
   * shape is unchanged and a renderer showing one document at a time needs
   * nothing. The renderer puts the same class on the element it mounts.
   */
  scope?: string;
  /**
   * The document limits this site enforces, for bounding the node walk.
   *
   * The same object validation takes, so a caller that raised or lowered a
   * limit gets one answer from both halves rather than a stylesheet compiled
   * against a bound the document was never held to. Defaults to the standard
   * limits when the caller has no opinion.
   */
  limits?: DocumentLimits;
  /**
   * Whether to record where each emitted declaration came from.
   *
   * Off by default, and deliberately: a visitor's page render has no use for it, and building it
   * there would put an editor-only structure on the path that matters most. An editor asks for it
   * once per compile and indexes what it gets, so a control's question is a lookup rather than a
   * walk over the page.
   */
  trace?: boolean;
}

/** A library entry's id, for a record that may not have one. */
export function readClassId(value: unknown): unknown {
  return value === null || typeof value !== "object"
    ? value
    : (value as { id?: unknown }).id;
}

/** A library entry's slug, for a record that may not have one. */
export function readClassSlug(value: unknown): unknown {
  return value === null || typeof value !== "object"
    ? value
    : (value as { slug?: unknown }).slug;
}

/** A compiled page stylesheet. */
export interface CompiledPageCss {
  css: string;
  /**
   * The scope these selectors were actually written under, or `undefined` when
   * they were written unscoped.
   *
   * Returned rather than assumed to equal the requested one, because a scope
   * this compiler cannot write is dropped and the sheet compiled global. A
   * caller recording the REQUESTED scope then stores an artifact claiming an
   * isolation its CSS does not have — and the renderer attaches that class, so
   * the rules reach whatever else is on the page.
   */
  scope?: string;
  /**
   * The container these breakpoints were aimed at, when the compile was a
   * PREVIEW one, and absent when it was published.
   *
   * Returned rather than assumed to equal the requested name, for the reason
   * {@link CompiledPageCss.scope} gives about scopes: `previewContainerName`
   * refuses an empty, reserved, malformed or oversized value and the compile
   * falls back to published `@media`, so a caller recording what it ASKED for
   * would stamp a published sheet as a preview one — and, worse, the reverse
   * never happens, so the mistake is silent in exactly one direction.
   *
   * It is on the output because a preview sheet is not publishable: its
   * viewport tiers are `@container` rules naming a box only the previewing
   * surface declares, so served on a published page they match nothing and the
   * page silently loses every breakpoint above the base one. A reader handed a
   * stored artifact has no other way to tell the two apart.
   */
  previewContainer?: string;
  /**
   * What was not written, and why. Every entry names a value that is in the
   * document and absent from the stylesheet, so "my style did nothing" always
   * has an answer.
   */
  warnings: ValidationIssue[];
  /**
   * The classes to put on each node id, space-separated: its own, then every
   * named class it applies that the stylesheet actually wrote.
   *
   * Returned rather than recomputed by the renderer because two ids can hash
   * alike: only a pass over the whole document sees that, and a renderer that
   * derived the class per node in isolation would give both nodes the same one.
   * The named classes are here for a second reason — a `.nx-c-*` rule reaches
   * an element only if the element carries the token, so a renderer applying
   * this value is what makes that tier do anything at all.
   */
  classes: Map<string, string>;
  /**
   * Every declaration written, in the order it was written, with its origin.
   *
   * Present only when the caller set `trace`. The order is the cascade: everything here is
   * anchored at the page root at one specificity, so a later entry beats an earlier one wherever
   * both match the same element.
   */
  trace?: readonly StyleTraceEntry[];
  /**
   * The node-local rules of every node a reader may not serve, keyed by node id and EXCLUDED from
   * `css`. Two things put a node here: its own `visibility.conditions` (or an ancestor's), and a
   * block answering {@link StyleCompileContext.drawsNothing} for its props.
   *
   * A page's stylesheet is compiled when the document is saved; whether a node draws is settled
   * when the page is read. So a single pre-compiled string carries rules for nodes a reader will
   * prune — and any `url(...)` inside them — publishing the assets of a block whose markup is
   * withheld. A reader appends the entries whose nodes survived.
   *
   * Only NODE-LOCAL rules move. A block type's base rules stay in `css`, because an
   * unconditional node may share the type and those rules come from the block definition rather
   * than from anything an author gated.
   *
   * Absent when the document gates nothing, which keeps `css` byte-identical for every document
   * that has no conditions. Additive: a reader that does not know this field renders the main
   * sheet and leaves gated nodes unstyled rather than breaking.
   */
  gated?: Readonly<Record<string, string>>;
}
