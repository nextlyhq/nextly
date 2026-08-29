/**
 * Compiling a document's stored styles into one stylesheet.
 *
 * A pure function of persisted data. It reads a document and a context the
 * caller loaded; it never reaches into storage, never calls a block's `render`,
 * and imports no framework. Styles are therefore never collected while
 * something renders, which is the failure mode this design exists to avoid: a
 * stylesheet assembled during a render is missing whatever did not render, and
 * the bug shows up as a block that looks right until the day it is the only
 * thing on the page.
 *
 * Everything is anchored to the page root and emitted at the same specificity,
 * so precedence comes from source order alone. That is why the tiers below are
 * emitted whole, one after another, rather than interleaved by breakpoint: a
 * node's own style beats its block type's default at every width, which is only
 * true if the whole of one tier precedes the whole of the next.
 *
 * @module style/compile-page
 */
import type {
  BlockDocument,
  BlockNode,
  BreakpointDef,
  BreakpointSet,
  NodeStyles,
  StyleState,
} from "../document";
import {
  MAX_BREAKPOINTS_PER_AXIS,
  MAX_BREAKPOINT_ID_LENGTH,
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASSES,
  STYLE_STATES,
  isBlockType,
} from "../document";
import { describeValue, pointer } from "../issue-text";
import { DEFAULT_LIMITS } from "../limits";
import type { DocumentLimits } from "../limits";
import { isPlainRecord } from "../plain-record";
import { selectNodes } from "../select-nodes";
import type { ValidationIssue } from "../validation";
import { isConditionGated } from "../visibility";

import { BREAKPOINT_AXES } from "./breakpoint-axes";
import type { BreakpointAxis } from "./breakpoint-axes";
import { escapeIdentifier } from "./css-value";
import type { MayFetchUrl } from "./css-value";
import { compileStyleValues, DEFAULT_TOKEN_PREFIX } from "./declarations";
import type { Declaration } from "./declarations";
import type { NamedClass } from "./named-class";
import {
  isUsableNamedClass,
  namedClassName,
  orderedNamedClasses,
  orderedNamedClassPositions,
  usableNamedClassPositions,
  MAX_NAMED_CLASS_NAME_LENGTH,
  NAMED_CLASS_SLUG_RE,
} from "./named-class";
import {
  blockTypeClassName,
  nodeClassNames,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "./node-class";
import { serializeRules } from "./serialize";
import type { CssRule } from "./serialize";
import type { StyleOrigin, StyleTraceEntry } from "./style-trace";
import type { StyleIssueBudget } from "./validate-style-value";
import { newStyleIssueBudget } from "./validate-style-value";
import {
  allowanceSpent,
  newWarningAllowance,
  pushBoundedWarning,
} from "./warning-allowance";
import type { WarningAllowance } from "./warning-allowance";

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
   * did not change. See {@link BreakpointContextOptions.previewContainer}.
   */
  previewContainer?: string;
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
   * A provisional layer, not a design system. Gutenberg — the closest peer that
   * both ships blocks and renders pages — keeps metric defaults out of block
   * CSS and defers to a theme; Nextly has no populated typography scale yet, so
   * this bridges the gap until the fonts manager fills it, and is shaped so
   * that manager can supply the same record later.
   */
  elementBases?: Readonly<Partial<Record<TypographicElement, NodeStyles>>>;

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
function readClassId(value: unknown): unknown {
  return value === null || typeof value !== "object"
    ? value
    : (value as { id?: unknown }).id;
}

/** A library entry's slug, for a record that may not have one. */
function readClassSlug(value: unknown): unknown {
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

/**
 * The pseudo-class each stored state compiles to.
 *
 * Wrapped in `:where()`, which matches identically and contributes NOTHING to
 * specificity. Everything this module emits is anchored at the page root and
 * meant to be decided by source order alone; a bare `:hover` is worth a class,
 * so a block type's default hover colour would beat a node's own colour however
 * late the node's rule came, and a node given its own colour would still change
 * colour on hover having said nothing about hovering.
 *
 * Zeroing them is only half of it: at equal specificity source order decides, so
 * the order states and breakpoints are emitted in becomes the cascade. See
 * `envelopeRules`.
 *
 * `:focus-visible`, not `:focus`. Styling every focus paints a ring on mouse
 * users who never asked for one, which is why authors historically removed focus
 * styling altogether and broke keyboard navigation.
 */
/**
 * The elements a typographic default may be written for.
 *
 * Closed and ordered: closed because a tag is interpolated into a selector and
 * a caller-supplied one would be an injection surface of exactly the kind the
 * block-type check below refuses; ordered because two defaults at equal
 * specificity are separated by source order, so the order they are emitted in
 * is part of the contract rather than an artifact of iteration.
 */
export const TYPOGRAPHIC_ELEMENTS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
] as const;

/**
 * An element a typographic default may be written for.
 *
 * The type is the allow-list rather than a widening of it, so a tag the
 * compiler does not emit — a typo, or `blockquote` before anyone decides it
 * belongs — is refused where it is written instead of silently contributing
 * nothing. A caller reading `Record<string, …>` has no way to learn which keys
 * are honoured except by trying one.
 */
export type TypographicElement = (typeof TYPOGRAPHIC_ELEMENTS)[number];

const STATE_SELECTORS: Readonly<Record<StyleState, string>> = {
  base: "",
  hover: ":where(:hover)",
  focus: ":where(:focus-visible)",
  active: ":where(:active)",
};

/** One breakpoint to emit under, with the at-rule it needs. */
export interface BreakpointContext {
  id: string;
  atRule?: string;
  /** Which axis this belongs to; visibility bands are computed per axis. */
  axis?: BreakpointAxis;
  /** The upper bound, for narrowing a hiding rule that a narrower id undoes. */
  maxWidth?: number;
}

/**
 * Whether a stored definition names itself in a way this engine can read.
 *
 * Length BEFORE anything else reads the id, which is the ordering
 * `isUsableNamedClass` states its own reason for. The id is a lookup key every
 * reader of the normalised axis carries, so an unbounded one is copied on each
 * call — and that call runs on every render keyed on what a site emits under,
 * including one whose stylesheet is reusable.
 */
function namedDefinition(
  def: unknown
): def is Record<string, unknown> & { id: string } {
  return (
    isPlainRecord(def) &&
    typeof def.id === "string" &&
    def.id.length <= MAX_BREAKPOINT_ID_LENGTH
  );
}

/**
 * Whether a stored bound is one a media or container query can be built from.
 *
 * A `maxWidth` that is not a positive finite number is dropped rather than read
 * as unbounded: unbounded is not a safe reading of a broken bound, since it
 * would apply the breakpoint's values at every width the author meant to
 * exclude. Zero and below are as unusable and quieter about it — nothing has a
 * negative width, so `@media (max-width: -1px)` is well-formed and can never
 * match, and kept, its id would count as known while everything stored under it
 * went missing with nothing reported.
 */
function emittableBound(maxWidth: unknown): boolean {
  return (
    typeof maxWidth === "number" && Number.isFinite(maxWidth) && maxWidth > 0
  );
}

/**
 * The at-rule keyword a context's queries are asked under, and the container
 * they name when they are not asked of the window.
 *
 * ONE derivation, because two places need it and they answered differently: the
 * contexts built below, and the bounded query a visibility band emits. While
 * the band rebuilt the keyword from the axis alone, a previewed page kept
 * `@media` for its visibility while its styles had moved to a container query —
 * so a node could be styled for a width it was simultaneously hidden at.
 */
/** The longest preview container name this compiler will emit. */
export const MAX_PREVIEW_CONTAINER_LENGTH = 64;

/**
 * Names a `<custom-ident>` may not take, whatever its shape.
 *
 * `none` is excluded from `container-name` by its own grammar, and the CSS-wide
 * keywords are excluded from every custom identifier. Matching the identifier
 * pattern is therefore necessary and not sufficient.
 */
const RESERVED_CONTAINER_NAMES: ReadonlySet<string> = new Set([
  "none",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
  "default",
  /*
   * The container-query QUERY keywords, which the grammar excludes from a
   * container name for a different reason than the CSS-wide keywords above.
   *
   * `@container <name>? <condition>` puts the name and the condition adjacent
   * with nothing between them, so a name spelled `and` or `or` produces
   * `@container and (max-width: 991px)` — not a container named `and`, but a
   * malformed condition, which a browser drops entirely. `not` is worse than
   * malformed: it PARSES, as the negation of the following condition, so the
   * rule silently applies at every width the author meant to exclude.
   *
   * The consequence is the one this whole helper exists to prevent: the box
   * establishes a perfectly valid named container while its responsive rules
   * are dropped or evaluated inverted, with nothing on screen to say why.
   */
  "and",
  "or",
  "not",
]);

/**
 * A preview container name this compiler is willing to write into an at-rule,
 * or `undefined` for anything it is not.
 *
 * Refusing rather than escaping, because a name that needs escaping is not a
 * name a caller meant: the value is a CSS custom identifier the previewing
 * surface also has to put in its own `container-name`, so anything that would
 * have to be transformed on the way out would no longer match what the caller
 * declared. Refusing degrades to a published compile, which is a sheet that is
 * merely not previewable — writing an unescaped one degrades to a stylesheet
 * that does not parse.
 *
 * Four rejections, and each is a different failure:
 *
 * - EMPTY or blank produces `@container (max-width: N)` with no name at all,
 *   which binds to the nearest ancestor query container — including an author's
 *   own. That is the exact capture the container axis is named to avoid.
 * - The RESERVED unpreviewable name aims the viewport axis at the same
 *   container as the container axis, so the rules kept deliberately inert
 *   become live against the preview box.
 * - Anything outside a CSS identifier can close the at-rule and open something
 *   else. `emittable-string-bounds.ts` requires every string this compiler
 *   emits to be bounded, and an identifier's shape is the other half of that.
 * - Over the bound, because the name is copied into every preview at-rule and a
 *   caller digesting these inputs truncates at what this package promises.
 */
export function previewContainerName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  /*
   * The RAW length first, before `trim` or any other linear pass.
   *
   * Trimming a megabyte of whitespace to reach a refusal that was certain from
   * the length alone is work done on every compile, and this name is
   * caller-controlled and is normalised again while deriving artifact
   * identities — so the scan recurs on render paths rather than once.
   *
   * The cap is therefore on the RAW input, and that is a deliberate rule rather
   * than an optimisation that happens to agree. It does not agree: a name of
   * exactly the cap's length wrapped in spaces would be legal after trimming
   * and is refused here. That is the intended reading — the bound this package
   * publishes is on the string a caller hands over, so a caller digesting these
   * inputs can check the value it holds rather than a trimmed form it would
   * have to derive first.
   */
  if (value.length > MAX_PREVIEW_CONTAINER_LENGTH) return undefined;
  const name = value.trim();
  if (name.length === 0) return undefined;
  if (name === UNPREVIEWABLE_CONTAINER) return undefined;
  // The CSS-wide keywords and `none`, which the grammar excludes from a
  // `<custom-ident>` however well they match its shape. Emitted, they make an
  // at-rule the browser drops AND a `container-name` the surface cannot declare,
  // so the preview loses its rules rather than degrading to the published
  // compile the way every other refusal here does.
  if (RESERVED_CONTAINER_NAMES.has(name.toLowerCase())) return undefined;
  // A CSS custom identifier, conservatively: letters, digits, hyphen and
  // underscore, not starting with a digit. Narrower than the grammar allows,
  // because the escapes the full grammar permits are exactly what this refuses
  // to emit.
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ? name : undefined;
}

function queryPrefix(
  axis: BreakpointAxis,
  preview: string | undefined
): string {
  if (preview === undefined) {
    return axis === "container" ? "@container" : "@media";
  }
  return axis === "container"
    ? `@container ${UNPREVIEWABLE_CONTAINER}`
    : `@container ${preview}`;
}

/**
 * The default container name a preview sheet aims its VIEWPORT breakpoints at.
 *
 * A DEFAULT, not a guarantee. A CSS identifier cannot be reserved globally and
 * blocks render host-defined markup and stylesheets, so a nearer ancestor
 * declaring `container: nx-preview-viewport / inline-size` would satisfy the
 * named query first — and viewport tiers would then follow that inner element
 * instead of the preview box, so resizing the canvas shows the wrong
 * breakpoint. The container axis is protected by an impossible condition
 * instead; the viewport axis cannot be, because it has to match something.
 *
 * A surface that renders untrusted or third-party blocks should mint its own
 * name with {@link previewContainerFor} and pass the SAME value to the compile
 * and to its box. This constant remains for the ordinary case, where the
 * previewing surface controls the markup inside it.
 */
export const PREVIEW_VIEWPORT_CONTAINER = "nx-preview-viewport";

/**
 * A stable 64-bit digest of a seed, as two base-36 halves.
 *
 * FNV-1a, computed in two independently seeded 32-bit passes rather than one,
 * because a single 32-bit digest collides at roughly one pair in 65k surfaces
 * by the birthday bound — near enough to be reachable on a large site, and a
 * collision here silently gives two boxes one container name.
 *
 * Written out rather than taken from a hashing library because it has to agree
 * across the server render and the client hydration, and pure integer maths on
 * a string is the same in both. `Math.imul` and `>>> 0` keep every step inside
 * 32 bits, which plain `*` would not.
 */
/**
 * What every minted preview name starts with.
 *
 * Named because the length check and the two constructions below must agree on
 * it: a prefix counted as one length and written as another either sanitises a
 * seed it did not need to, or lets an over-bound name reach
 * `previewContainerName` and take the digest path for the wrong reason.
 */
const PREVIEW_SEED_PREFIX = "nx-preview-";

/**
 * Which of the two constructions produced the rest of the name.
 *
 * The mark is what makes the literal and digested namespaces DISJOINT, and
 * without it they share one space and collide across paths: a surface seeded
 * `"a/b"` digests to some base-36 string, and a second surface seeded with that
 * very string is identifier-safe, carries literally, and lands on the same
 * name. Marking only one side does not close it either — a literal seed can
 * begin with whatever single mark the digest uses, so the ambiguity just moves.
 *
 * Marking BOTH at a FIXED position does close it, by construction rather than
 * by argument: the character at that offset is `s` for one path and `d` for the
 * other, whatever the seed contains, so no pair of inputs can meet.
 */
const LITERAL_MARK = "s-";
const DIGEST_MARK = "d-";

function digest(seed: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

/**
 * The seed carried LITERALLY, or `undefined` when carrying it would lose
 * information.
 *
 * The reduction to identifier-safe characters is many-to-one: `a/b` and `a:b`
 * both become `a-b`. Carrying the reduced form is therefore only sound when the
 * reduction changed NOTHING — otherwise two distinct surfaces receive one name,
 * which is precisely the collision the factory exists to prevent, and an
 * authored container spelled `nx-preview-a-b` would capture the responsive
 * queries of every surface that collides there.
 *
 * Compared against the original rather than tested for "contains an unsafe
 * character", because those are the same question and only one of them has a
 * character class to keep up to date.
 */
function losslessName(seed: string): string | undefined {
  const safe = seed.replace(/[^A-Za-z0-9_-]/g, "-");
  if (safe !== seed) return undefined;
  return previewContainerName(`${PREVIEW_SEED_PREFIX}${LITERAL_MARK}${safe}`);
}

/**
 * A preview container name unlikely to collide with an authored one.
 *
 * Derived from a seed the CALLER owns — a React `useId`, a surface id, anything
 * stable for the lifetime of that box — rather than generated randomly here, so
 * the name a server renders and the name a client hydrates are the same string.
 * A random one would differ across that boundary and the preview would match
 * nothing on exactly the first paint.
 *
 * The seed is reduced to identifier-safe characters rather than rejected, so a
 * caller passing an opaque id from elsewhere does not have to know this
 * function's rules to use it.
 *
 * **A seed that cannot be carried LITERALLY is DIGESTED, never dropped**, and
 * that is two cases rather than one. A seed over about fifty characters exceeds
 * the emitted-name bound once prefixed; a seed containing anything outside
 * `[A-Za-z0-9_-]` cannot be carried either, because the reduction is
 * many-to-one and two distinct seeds would receive one name. Returning the
 * shared default in either case would hand exactly the surfaces most likely to
 * hit them — document paths, composite keys, opaque route ids — the one
 * globally predictable name this function exists to avoid. The digest keeps the
 * name per-surface and inside the bound.
 *
 * Two distinct seeds can still digest alike; the guarantee is a low collision
 * probability, not uniqueness. That is the right trade here because the cost of
 * a collision is two boxes sharing a container name, while the cost of the
 * fallback was every long-seeded surface sharing one with THIRD-PARTY markup.
 */
export function previewContainerFor(seed: string): string {
  /*
   * The length is decided BEFORE any linear pass, the same way
   * `previewContainerName` decides it before trimming.
   *
   * A seed that cannot fit under the bound once prefixed is going to be
   * digested whatever it contains, so sanitising it first walks the whole
   * string, allocates a full copy, builds a second oversized string in the
   * template, and has it refused — then the digest walks the original anyway.
   * Three passes and two allocations to reach a conclusion the length alone
   * settles. Surfaces call this during render and again on hydration, so the
   * work recurs rather than happening once.
   */
  const literal =
    PREVIEW_SEED_PREFIX.length + LITERAL_MARK.length + seed.length >
    MAX_PREVIEW_CONTAINER_LENGTH
      ? undefined
      : losslessName(seed);
  if (literal !== undefined) return literal;
  /*
   * Digested from the ORIGINAL seed rather than the reduced form, so two seeds
   * differing only in characters the reduction collapses — `a/b` and `a:b` both
   * become `a-b` — still produce different names.
   */
  return (
    previewContainerName(
      `${PREVIEW_SEED_PREFIX}${DIGEST_MARK}${digest(seed)}`
    ) ?? PREVIEW_VIEWPORT_CONTAINER
  );
}

/**
 * The container name a preview sheet aims its CONTAINER breakpoints at, which
 * is deliberately one nothing carries.
 *
 * A container breakpoint responds to the width of the element's OWN container,
 * so it cannot be previewed by resizing a canvas — the answer depends on where
 * the block sits, not on the surface around it. Left unnamed, those queries
 * would resolve against the preview container instead, and the editor would
 * show container styles the published page does not.
 *
 * Named to something no element declares rather than omitted, so the contexts
 * keep their ids: a style stored at a container breakpoint stays a KNOWN
 * breakpoint that simply does not apply here, instead of becoming an unknown
 * one and collecting a warning on every render.
 */
export const UNPREVIEWABLE_CONTAINER = "nx-not-previewable";

/**
 * A container condition no container can satisfy.
 *
 * The NAME is a label and this is the guarantee. A CSS identifier cannot be
 * reserved globally — blocks render host-defined markup and stylesheets, so
 * anything may declare `container-name: nx-not-previewable`, and a rule kept
 * inert only by nobody using that name becomes live the moment somebody does.
 *
 * A width is never negative, so `(width < 0px)` is false against every
 * container, in every browser, whatever names are in scope. Valid syntax that
 * evaluates false is a boundary; an unused name is a convention.
 */
const UNSATISFIABLE_CONDITION = "(width < 0px)";

/**
 * How to emit the contexts, when the caller is not the published page.
 */
export interface BreakpointContextOptions {
  /**
   * Emit VIEWPORT breakpoints as container queries against this container name.
   *
   * For a surface that shows the page inside a resizable box rather than at the
   * browser's own width. `@media` asks the WINDOW, so a box narrowed to a
   * breakpoint's width changes nothing about which rules apply — the block gets
   * narrower and keeps its widest styling, which is a preview that lies. A
   * container query asked of the box answers about the box.
   *
   * Absent for every published render, and absent is the default so that the
   * artifact identity a caller derives from these contexts is byte-identical to
   * what it was before this option existed. A stamp that moved would invalidate
   * every artifact on the site for CSS that did not change.
   */
  readonly previewContainer?: string;
}

/**
 * The breakpoints to emit, in cascade order.
 *
 * The base breakpoint first and unconditional, then viewport widths descending,
 * then container widths descending. Descending because the model is
 * desktop-first: the unconditional rule describes the widest layout and each
 * narrower breakpoint overrides it, so a narrower one has to come later to win.
 * Container rules follow viewport rules so that an element asked to respond to
 * its own box wins over the same value keyed to the window.
 *
 * Public because it is the only answer to "which breakpoints does this site
 * actually emit under". A stored settings axis is not that answer: definitions
 * whose bound is missing, unusable or duplicated are dropped here, the rest are
 * sorted and capped, and each survivor carries the at-rule text itself. Anything
 * keyed on the emitted stylesheet — a cache stamp, most of all — has to read
 * this rather than the raw set, because two axes that differ only in what this
 * function discards produce byte-identical CSS.
 */
export function breakpointContexts(
  // Widened past what the compiler's own caller holds, because the answer is
  // read by anything keyed on what this site's breakpoints ARE, and those
  // readers hold the stored settings record rather than a validated context.
  // The body already treats the argument as untrusted, so an absent set answers
  // with the base context alone rather than being a case to guard at each call.
  set: BreakpointSet | undefined,
  options?: BreakpointContextOptions
): BreakpointContext[] {
  const preview = previewContainerName(options?.previewContainer);
  // The base context carries no upper bound and no at-rule, but it still needs
  // to be bounded from below when a narrower breakpoint shows a node again:
  // without that, hiding at base emits an unconditional rule that a later
  // `true` cannot undo.
  const contexts: BreakpointContext[] = [
    { id: BASE_BREAKPOINT, axis: "viewport" },
  ];
  // One id resolves to one definition. Each axis is read separately, so a
  // duplicate — within an axis or across the two — would become two contexts,
  // and a single stored value keyed to it would be emitted under both queries:
  // one `dup` responding to viewport width AND to container width, from the one
  // thing the document model says cannot happen. The document model calls this
  // an error; compilation is the path that does not assume validation ran, so
  // the first definition wins and the rest are not ids this site defines.
  const claimed = new Set<string>([BASE_BREAKPOINT]);
  let unboundedContainer = false;
  const widthDescending = (a: BreakpointDef, b: BreakpointDef): number =>
    (b.maxWidth ?? Infinity) - (a.maxWidth ?? Infinity);
  // The breakpoint set comes from stored settings, so it is read the way
  // validation reads it: as untrusted. A null axis or a malformed definition is
  // skipped rather than dereferenced, because throwing here would take down
  // every page on the site over one corrupt settings record, and rendering is
  // the half a reader still gets after forgiving validation let the document
  // through.
  //
  // A definition whose `maxWidth` is not a positive finite number is dropped
  // rather than treated as unbounded. Unbounded is not a safe reading of a broken bound: it
  // would emit the breakpoint's values unconditionally, applying at every width
  // the author meant to exclude. Dropped, the id is simply not one this site
  // defines, and the values keyed to it are reported as stale like any other.
  //
  // Zero and below are as unusable as a NaN and quieter about it. Nothing has a
  // negative width, so `@media (max-width: -1px)` is a well-formed query that
  // can never match: kept, its id would count as known, and the styles and
  // hiding stored under it would go missing with nothing reported at all.
  const rawSet: unknown = set;
  const axisDefs = (axis: BreakpointAxis): BreakpointDef[] => {
    const defs = isPlainRecord(rawSet) ? rawSet[axis] : undefined;
    if (!Array.isArray(defs)) return [];
    // Bounded on the RAW axis, before anything reads it. A bound applied after
    // the filter below bounds only the sort: the filter still visits every
    // stored definition and materialises every usable one, so a million-entry
    // row costs O(n) and its allocation on each call — and this is called on
    // every render keyed on what a site emits under, including one whose
    // stylesheet is reusable.
    //
    // The prefix is what a bound on unvalidated input can be. Past this many
    // definitions the survivors are chosen from the first `MAX_SCANNED_KEYS`
    // rather than from the whole axis, so an axis whose only usable entries sit
    // beyond that prefix now defines no breakpoints. Nothing legitimate is
    // close: the declared per-axis limit is `MAX_BREAKPOINTS_PER_AXIS`.
    const usable = defs
      .slice(0, MAX_SCANNED_KEYS)
      .filter((def: unknown): def is BreakpointDef => {
        if (!namedDefinition(def)) return false;
        // The base id names the unconditional context and carries no bound by
        // definition; it is skipped below, and asking it for one would drop the
        // very breakpoint every other rule is written against.
        if (def.id === BASE_BREAKPOINT) return true;
        if (def.maxWidth === undefined) {
          // Only one unbounded definition per container axis. Two both compile to
          // `@container (min-width: 0)`, so they cover the identical range and
          // whichever sorts later silently overrides the other — the same
          // ambiguity a duplicate id creates, spelled differently.
          if (axis === "container") {
            if (unboundedContainer) return false;
            unboundedContainer = true;
            return true;
          }
          // A VIEWPORT definition without a bound would emit no at-rule at all:
          // a second unconditional context, overriding the real base at every
          // width, from a settings record the type system accepts. The container
          // axis is not the same case and was answered above, because its
          // unbounded definition still emits a query and stays scoped.
          return false;
        }
        return emittableBound(def.maxWidth);
      });
    // The declared per-axis limit, enforced here because nothing else enforces
    // it. Every style envelope in the document scans the whole context list, so
    // the cost of a corrupt settings record is multiplied by every node rather
    // than paid once, and a byte-bounded document could still stall a render.
    // The widest are kept, and values keyed to the rest are reported stale like
    // any other id this site does not define.
    //
    // Bounded BEFORE the sort, which is what makes that limit bound the WORK and
    // not merely the output. `MAX_BREAKPOINTS_PER_AXIS` is applied to the result,
    // so a stored axis of a million definitions is still filtered and sorted in
    // full on the way to keeping seven — and anything keyed on what this returns
    // pays that on every render, including one whose stylesheet is reusable.
    // The same reasoning `isUsableNamedClass` states for putting a length test
    // ahead of its pattern test: a cheap rejection has to come first for the cap
    // to bound anything.
    //
    // Bounding the WORK is done above, on the raw axis, because a bound applied
    // here would leave the filter scanning all of it first.
    return usable
      .sort(widthDescending)
      .filter(def => {
        if (claimed.has(def.id)) return false;
        claimed.add(def.id);
        return true;
      })
      .slice(
        0,
        // The unconditional base context is inserted separately and filtered
        // out of this list, so counting only what survives would honour one
        // definition past the declared limit on the viewport axis.
        axis === "viewport"
          ? MAX_BREAKPOINTS_PER_AXIS - 1
          : MAX_BREAKPOINTS_PER_AXIS
      );
  };
  // Driven by the shared axis order rather than by two loops written in a
  // chosen sequence here. Which axis is emitted last decides which one wins at
  // equal specificity, so that order is stated once, as data, rather than being
  // implied by the shape of the code that walks it.
  for (const axis of BREAKPOINT_AXES) {
    for (const def of axisDefs(axis)) {
      if (def.id === BASE_BREAKPOINT) continue;
      contexts.push(
        axis === "viewport"
          ? {
              id: def.id,
              axis,
              maxWidth: def.maxWidth,
              ...(def.maxWidth === undefined
                ? {}
                : {
                    atRule: `${queryPrefix("viewport", preview)} (max-width: ${def.maxWidth}px)`,
                  }),
            }
          : {
              id: def.id,
              axis,
              maxWidth: def.maxWidth,
              // A container axis always emits a container query, the widest one
              // included. Left unconditional, the container's own base values would
              // apply to a node with no query-container ancestor at all, and would
              // outrank every viewport rule while doing it. `min-width: 0` matches
              // inside any container and nowhere else, which is exactly the scope.
              //
              // NAMED under preview, to a name nothing carries. An unnamed
              // container query resolves against the nearest ancestor that has
              // `container-type` set — named or not — so a preview surface that
              // makes its canvas a query container would capture these for every
              // node with no authored container ancestor, and show container
              // styles the published page does not. Naming them rather than
              // omitting them keeps their ids present, so a style stored at a
              // container breakpoint stays a known breakpoint rather than
              // becoming an unknown one.
              atRule:
                preview !== undefined
                  ? `@container ${UNPREVIEWABLE_CONTAINER} ${UNSATISFIABLE_CONDITION}`
                  : def.maxWidth === undefined
                    ? `@container (min-width: 0)`
                    : `@container (max-width: ${def.maxWidth}px)`,
            }
      );
    }
  }
  return contexts;
}

/**
 * The longest page scope this compiler will write into a selector.
 *
 * A scope keeps two documents rendered into one DOM apart, so it prefixes every
 * rule the page emits — an oversized one is therefore copied once per rule
 * rather than once per sheet. Generous against anything a host would pass: a
 * scope is an element id or a short generated token.
 */
export const MAX_SCOPE_LENGTH = 128;

/** The breakpoint id meaning "no media query" in a stored style envelope. */
export const BASE_BREAKPOINT = "base";

/**
 * The scope written as a class selector, or nothing when it cannot be one.
 *
 * A scope is what keeps two documents rendered into one DOM apart, and node
 * classes are unique only WITHIN a document, so losing it is not cosmetic:
 * their rules cross-apply and each document's page settings reach both roots.
 * Dropping it therefore has to be LOUD, and only when the value genuinely
 * cannot be a class.
 *
 * The value is escaped rather than pattern-matched. A class attribute holds any
 * whitespace-free token — a UUID starting with a digit, `_region`, `-region` —
 * and the CSS grammar simply cannot spell some of those raw, which is a question
 * of writing them correctly, not of whether they are allowed. Refusing them sent
 * exactly those documents back to the unscoped selector, which is the collision
 * this exists to prevent.
 *
 * Whitespace is the real exclusion: `a b` in a class attribute is two classes,
 * not one, so no escaping makes it the thing the renderer will have attached.
 */
function scopeSelector(
  scope: string | undefined,
  warnings: ValidationIssue[]
): string {
  if (scope === undefined) return "";
  // ASCII whitespace only, which is what HTML splits a class attribute on.
  // JavaScript's `\s` also matches NBSP and the Unicode spaces, and those do
  // NOT split a class: a renderer attaching `region\u00a0one` attaches one
  // valid class, so rejecting it here would drop the scope for a document whose
  // scope was fine and send it back to the selector every other document shares.
  // Bounded as well as shaped. The scope is a caller's string and every rule
  // this compiler writes carries it, so an oversized one is copied into the
  // sheet once per rule — and it is the last emitted string with no cap, which
  // `EMITTABLE_STRING_BOUNDS` is only honest about while none remain.
  if (
    scope === "" ||
    scope.length > MAX_SCOPE_LENGTH ||
    /[ \t\n\f\r]/.test(scope)
  ) {
    warnings.push({
      path: "/scope",
      code: "invalid-scope",
      severity: "warning",
      message: `"${describeValue(scope)}" cannot be one class, so this document's rules were not scoped and may apply to another document rendered beside it.`,
      suggestion: "Use a single class token with no whitespace.",
    });
    return "";
  }
  return `.${escapeIdentifier(scope)}`;
}

/**
 * Warn for style values keyed to a breakpoint the site does not define.
 *
 * A breakpoint id is just a string, so a document can outlive the breakpoint it
 * was written against: renaming or removing one leaves values keyed to an id
 * nothing resolves. Compiling only the ids the context knows would drop those
 * values without a word, and this result promises that anything missing from
 * the stylesheet is explained.
 */
/**
 * The keys of a stored record, bounded before they are sorted.
 *
 * Enumeration stops where reporting stops. Slicing before the sort rather than checking the
 * allowance inside the loop keeps neither the array nor the sort scaling with what was stored,
 * which matters because a named class is site settings read on every page compile and its map of
 * breakpoint ids is whatever was persisted.
 *
 * Which keys survive the slice does not matter: they feed diagnostics that are capped a few
 * entries later anyway.
 */
function boundedKeys(record: Record<string, unknown>): string[] {
  // Read with an early break rather than through `Object.keys`, which materialises every key
  // before anything can slice it — so a corrupt settings record still allocated an array its own
  // size on every compile, ahead of the cap that was supposed to bound it.
  const keys: string[] = [];
  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue;
    keys.push(key);
    if (keys.length >= MAX_SCANNED_KEYS) break;
  }
  return keys.sort();
}

/**
 * How many keys of one stored record are read before the walk gives up.
 *
 * Public because it is this engine's only answer to how wide a stored record can
 * be and still be read. A reader that walks the same records — a cache stamp,
 * most of all — has to stop where this stops, or a corrupt settings row costs it
 * the unbounded scan this bound exists to prevent while compilation pays 256.
 */
export const MAX_SCANNED_KEYS = 256;

function unknownBreakpointWarnings(
  styles: NodeStyles,
  basePath: string,
  contexts: readonly BreakpointContext[],
  warnings: ValidationIssue[],
  allowance: WarningAllowance
): void {
  if (allowanceSpent(allowance)) return;
  const known = new Set(contexts.map(context => context.id));
  const knownStates = new Set<string>(STYLE_STATES);
  // Iterating only the states this engine knows means an unrecognised one is
  // never compiled AND never mentioned. The envelope's own keys are read here
  // so a stored `pressed` is accounted for rather than disappearing.
  for (const state of boundedKeys(styles)) {
    if (!knownStates.has(state)) {
      pushBoundedWarning(allowance, warnings, {
        path: pointer(basePath, state),
        code: "invalid-style-state",
        severity: "warning",
        message: `"${describeValue(state)}" is not a style state, so nothing stored under it was written.`,
        suggestion: `Use one of: ${STYLE_STATES.join(", ")}.`,
      });
      continue;
    }
    if (allowanceSpent(allowance)) return;
    const byBreakpoint = styles[state as StyleState];
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const id of boundedKeys(byBreakpoint)) {
      // Enumeration stops where reporting stops. The allowance bounds what is
      // RETURNED, and a state map with a very large number of stale ids costs a
      // full sort and a full scan before that bound is ever consulted — work
      // done on every render to produce warnings already known to be capped.
      if (allowanceSpent(allowance)) break;
      if (known.has(id)) continue;
      pushBoundedWarning(allowance, warnings, {
        path: pointer(pointer(basePath, state), id),
        code: "unknown-breakpoint",
        severity: "warning",
        message: `Breakpoint "${describeValue(id)}" is not defined for this site, so these values were not written.`,
      });
    }
  }
}

/** What one envelope is, and what may be written from it. */
interface EnvelopeContext {
  origin: StyleOrigin;
  /** Appended to as declarations are emitted; absent when no caller asked for a trace. */
  trace?: StyleTraceEntry[];
  /** Which hosts this site will fetch from; unasked when absent. */
  mayFetchUrl?: MayFetchUrl;
  /**
   * The selector part kept OUTSIDE `:where()` when this envelope's rules are
   * written as defaults, with everything else wrapped.
   *
   * Set for the two DEFAULT tiers — a block type's and the typographic baseline
   * keyed by element — and for nothing else. The page-root prefix
   * is doubled so an AUTHOR's values beat ordinary host CSS, and defaults
   * inherited that contract without it ever being argued for them — but a
   * default nobody can override is not a default. Builder.io shipped
   * compound-class component defaults and answered the resulting complaints
   * with a global opt-out; every low-friction precedent that ships
   * rendered-block typography keeps it at the floor instead, Webflow on bare
   * tags and Tailwind Typography inside `:where()`.
   *
   * It also orders the three tiers by CONSTRUCTION rather than by emission
   * order: a type's default loses to a named class and to a node's own value
   * because it weighs nothing, not because it happens to be written first.
   *
   * **It is an anchor rather than a flag because zero is the wrong weight.**
   * Wrapping the WHOLE selector gives `0-0-0`, and an ordinary unlayered reset
   * — `h1, h2, … { font-size: inherit; margin: 0 }`, which is the shape
   * Tailwind's preflight ships — is `0-0-1` and beats it. A default written
   * that way loses to the very reset it exists to answer. Measured in a
   * browser: with the reset present, the fully wrapped rule left an `h1` at
   * 16px and the anchored one at its declared 36px.
   *
   * One class outside and the rest inside gives `0-1-0`, which is what
   * Tailwind Typography emits and what the two ends of the contract need: it
   * beats a bare element reset, and it still loses to a host's own
   * `.content h1` at `0-1-1`. The anchor is the SINGLE page-root class rather
   * than the doubled one, because doubling is how an author's values are made
   * to outrank host CSS and a default must not borrow that.
   *
   * `:where()` changes what a match WEIGHS and never what it selects, so the
   * same elements are styled either way.
   */
  weightlessAnchor?: string;
}

/** Compile one styles envelope into rules under one selector. */
function envelopeRules(
  styles: NodeStyles | undefined,
  selector: string,
  basePath: string,
  contexts: readonly BreakpointContext[],
  tokenPrefix: string,
  warnings: ValidationIssue[],
  budget: StyleIssueBudget,
  warningAllowance: WarningAllowance,
  /**
   * What this envelope IS and what may be written from it, grouped rather than
   * appended. Ten positional arguments was already past the point where a call
   * reads by position, and the policy below had to arrive with them: as an
   * eleventh optional in line it would have sat beside `trace` with nothing but
   * its type to tell the two apart, and a policy dropped in a mis-slotted call
   * leaves every URL in the document unasked about. Named fields cannot be
   * mis-slotted, and grouping takes the arity DOWN rather than up.
   */
  about: EnvelopeContext
): CssRule[] {
  const { origin, trace, mayFetchUrl, weightlessAnchor } = about;
  if (styles === undefined) return [];
  // A stored envelope that is not an object — `[]`, a string, `null` — styles
  // nothing, and this compiler reads persisted data whether or not a caller
  // validated it. Returning quietly would break the one promise this result
  // makes: that everything absent from the stylesheet is accounted for.
  if (!isPlainRecord(styles)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: basePath,
      code: "invalid-style-values",
      severity: "warning",
      message: `Styles here are ${describeValue(styles)} rather than an object, so none of them were written.`,
    });
    return [];
  }
  unknownBreakpointWarnings(
    styles,
    basePath,
    contexts,
    warnings,
    warningAllowance
  );
  const rules: CssRule[] = [];
  // State outside, breakpoint inside, and the nesting is the cascade. States
  // carry no specificity of their own, so what a rule beats is decided by what
  // comes after it, and each loop order encodes a different rule:
  //
  //   breakpoint outer — every state at base, then every state at tablet, so a
  //   narrower BASE value lands after a wider HOVER value and defeats it. A
  //   node coloured on hover everywhere and re-coloured at tablet would stop
  //   showing its hover colour there, having never said anything about it.
  //
  //   state outer — every breakpoint of base, then every breakpoint of hover.
  //   A narrower base still beats a wider base, which is the desktop-first
  //   model, and a hover value still beats a base value at any width, which is
  //   what "this is what it looks like while hovered" has to mean.
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    // The same account the envelope itself gets, one level down. A state whose
    // value is `[]` or a string styles nothing, and skipping it quietly leaves
    // an author with values in the document, no CSS on the page, and nothing
    // connecting the two.
    if (byBreakpoint !== undefined && !isPlainRecord(byBreakpoint)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer(basePath, state),
        code: "invalid-style-values",
        severity: "warning",
        message: `Styles for "${describeValue(state)}" are ${describeValue(byBreakpoint)} rather than an object, so none of them were written.`,
      });
      continue;
    }
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const context of contexts) {
      const values = byBreakpoint[context.id];
      const path = pointer(pointer(basePath, state), context.id);
      // And one level down again. `undefined` stays silent: a breakpoint a node
      // says nothing about is the normal case, not a malformed one.
      if (values !== undefined && !isPlainRecord(values)) {
        pushBoundedWarning(warningAllowance, warnings, {
          path,
          code: "invalid-style-values",
          severity: "warning",
          message: `Styles at "${describeValue(context.id)}" are ${describeValue(values)} rather than an object, so none of them were written.`,
        });
        continue;
      }
      if (!isPlainRecord(values)) continue;
      const compiled = compileStyleValues(
        values,
        path,
        tokenPrefix,
        budget,
        warningAllowance,
        { mayFetchUrl }
      );
      // Appended as they come. `compileStyleValues` holds this same allowance and charges
      // everything it returns against it exactly once, so charging again here would spend it
      // twice and leave later omissions unexplained while it still had room.
      warnings.push(...compiled.warnings);
      // A property that styles something inside the block goes into its own
      // rule. Keeping the exception in the catalog rather than in a branch here
      // is what makes the set of them enumerable; this only has to honour it.
      for (const rule of groupByDescendant(compiled.declarations)) {
        rules.push({
          ...(context.atRule === undefined ? {} : { atRule: context.atRule }),
          // Everything after the anchor is wrapped, state and descendant
          // included: `${anchor} :where(x) a` leaves the `a` outside carrying
          // weight of its own, so a default that styles something inside
          // itself would outrank a host rule of the same shape. The anchor is
          // the only part that weighs.
          selector:
            weightlessAnchor === undefined
              ? `${selector}${STATE_SELECTORS[state]}${rule.descendant}`
              : `${weightlessAnchor} :where(${selector}${STATE_SELECTORS[state]}${rule.descendant})`,
          declarations: rule.declarations,
        });
        // Recorded here, from the same declarations that were just emitted, in the same loop.
        // Anywhere else it would be a second reading of the document, and a second reading can
        // disagree with the first — which is the one failure a provenance record must not have.
        if (trace === undefined) continue;
        for (const declaration of rule.declarations) {
          trace.push({
            origin,
            property: declaration.property,
            value: declaration.value,
            ...(rule.descendant === "" ? {} : { descendant: rule.descendant }),
            state,
            breakpoint: context.id,
            ...(context.atRule === undefined ? {} : { atRule: context.atRule }),
          });
        }
      }
    }
  }
  return rules;
}

/** Split declarations by the descendant they attach to, root first. */
function groupByDescendant(
  declarations: readonly Declaration[]
): { descendant: string; declarations: Declaration[] }[] {
  const groups = new Map<string, Declaration[]>();
  for (const declaration of declarations) {
    const key =
      declaration.descendant === undefined ? "" : ` ${declaration.descendant}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [declaration]);
    else group.push(declaration);
  }
  return (
    [...groups.entries()]
      // The node's own rule first, then descendants in a fixed order, so the same
      // document always serializes the same way.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([descendant, group]) => ({ descendant, declarations: group }))
  );
}

/**
 * Rules hiding a node at the breakpoints it is marked hidden for.
 *
 * Visibility is not a style property: it is stored on the node rather than in
 * its style envelope, and a value of `false` means "not shown here" rather than
 * naming a CSS property. Compiling it here keeps the one place that turns a
 * document into CSS in one file.
 *
 * Hiding INHERITS downward, the way every other value in a desktop-first model
 * does: marked hidden at tablet and unmarked below, a node stays hidden on a
 * phone. Marking it visible again at a narrower breakpoint has to stop that,
 * which a plain `max-width` rule cannot do, because the wider rule still
 * matches at the narrower width. Such a rule is bounded below instead, so it
 * covers its own band and stops where the author said to stop.
 */
function visibilityRules(
  node: BlockNode,
  selector: string,
  contexts: readonly BreakpointContext[],
  basePath: string,
  warnings: ValidationIssue[],
  warningAllowance: WarningAllowance,
  preview: string | undefined
): CssRule[] {
  // The containing structures get the same account as the values inside them.
  // A `visibility` or `devices` that is an array, a string or null applies none
  // of what it holds, and returning quietly is indistinguishable from a node
  // that simply said nothing about being hidden.
  const visibility: unknown = node.visibility;
  if (visibility !== undefined && !isPlainRecord(visibility)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer(basePath, "visibility"),
      code: "invalid-visibility",
      severity: "warning",
      message: `Visibility is ${describeValue(visibility)} rather than an object, so none of it was applied and the node stays visible.`,
    });
    return [];
  }
  const devices: unknown = isPlainRecord(visibility)
    ? visibility.devices
    : undefined;
  if (devices !== undefined && !isPlainRecord(devices)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer(pointer(basePath, "visibility"), "devices"),
      code: "invalid-visibility",
      severity: "warning",
      message: `Visibility devices are ${describeValue(devices)} rather than an object, so none of them were applied and the node stays visible.`,
    });
    return [];
  }
  if (!isPlainRecord(devices)) return [];
  const rules: CssRule[] = [];
  const known = new Set(contexts.map(context => context.id));
  for (const id of Object.keys(devices).sort()) {
    if (known.has(id)) continue;
    // The same promise the style envelope keeps: a breakpoint the site no
    // longer defines leaves a stored `false` that hides nothing, and saying so
    // is the difference between a node that reappears and a mystery.
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer(pointer(pointer(basePath, "visibility"), "devices"), id),
      code: "unknown-breakpoint",
      severity: "warning",
      message: `Breakpoint "${describeValue(id)}" is not defined for this site, so this visibility setting was not applied.`,
    });
  }
  // Per axis: a container breakpoint neither inherits from nor cancels a
  // viewport one, because the two ask about different boxes.
  for (const axis of ["viewport", "container"] as const) {
    const axisContexts = contexts.filter(context => context.axis === axis);
    let hidden = false;
    let hidingFrom: BreakpointContext | undefined;
    const flush = (lowerBound: number | undefined): void => {
      if (hidingFrom === undefined) return;
      const atRule = boundedAtRule(hidingFrom, lowerBound, preview);
      rules.push({
        ...(atRule === undefined ? {} : { atRule }),
        // Hiding has to beat the node's own `display`, including one stored on
        // a state: `.node:focus-visible { display: block }` outranks a plain
        // `.node { display: none }` however late it comes, so a focused node
        // would stay on screen at a width it is meant to be gone from. Doubling
        // the node class raises this rule above every state selector without
        // reaching for `!important`, which an author could not then override.
        selector: selector.replace(
          /(\.[A-Za-z0-9_-]+)$/,
          (match: string) => `${match}${match}`
        ),
        declarations: [{ property: "display", value: "none" }],
      });
      hidingFrom = undefined;
    };
    for (const context of axisContexts) {
      const declared = devices[context.id];
      // A stored value that is neither boolean decides nothing, and deciding
      // nothing here means the node stays visible. This compiler reads
      // persisted data whether or not a caller validated it, and promises that
      // anything missing from the stylesheet is explained, so `"false"` — a
      // string that reads exactly like the thing it is not — has to be said out
      // loud rather than treated as "no opinion".
      if (declared !== undefined && typeof declared !== "boolean") {
        pushBoundedWarning(warningAllowance, warnings, {
          path: pointer(
            pointer(pointer(basePath, "visibility"), "devices"),
            context.id
          ),
          code: "invalid-visibility",
          severity: "warning",
          message: `Visibility at "${describeValue(context.id)}" is ${describeValue(declared)} rather than true or false, so it was not applied and the node stays visible here.`,
        });
        continue;
      }
      if (declared === false && !hidden) {
        hidden = true;
        hidingFrom = context;
        continue;
      }
      if (declared === true && hidden) {
        hidden = false;
        flush(context.maxWidth);
      }
    }
    // Still hidden at the narrowest breakpoint, so the rule runs all the way
    // down and needs no lower bound.
    flush(undefined);
  }
  return rules;
}

/**
 * An at-rule narrowed to stop at a lower bound.
 *
 * Only ever used for a hiding rule that a narrower breakpoint undoes; every
 * other rule inherits downward and wants no floor.
 */
function boundedAtRule(
  context: BreakpointContext,
  lowerBound: number | undefined,
  preview: string | undefined
): string | undefined {
  if (lowerBound === undefined) return context.atRule;
  /*
   * A band on a context that can never match cannot match either.
   *
   * The container axis under preview carries an impossible condition rather
   * than a bound, and rebuilding the wrapper from the prefix alone dropped it —
   * leaving a merely NAMED query that an authored ancestor could satisfy. The
   * node's styles would stay impossible while its visibility band went live, so
   * preview visibility disagreed with preview styling.
   *
   * Returned whole rather than reconstructed, because the context already
   * states the condition and a second construction of it is what diverged.
   */
  if (context.atRule?.includes(UNSATISFIABLE_CONDITION) === true) {
    return context.atRule;
  }
  const feature = queryPrefix(context.axis ?? "viewport", preview);
  const upper =
    context.maxWidth === undefined
      ? ""
      : `(max-width: ${context.maxWidth}px) and `;
  // A strict lower bound rather than the next whole pixel. Breakpoint widths
  // are arbitrary numbers, so adding one can erase the band entirely — bounds
  // of 640.5 and 640 would ask for `(max-width: 640.5px) and (min-width: 641px)`
  // — and even between whole numbers it leaves fractional widths uncovered,
  // which is exactly where a device pixel ratio puts a viewport.
  return `${feature} ${upper}(width > ${lowerBound}px)`;
}

/** One node, the pointer that resolves to it, and whether anything gates it. */
interface PlacedNode {
  node: BlockNode;
  path: string;
  /**
   * Whether this node is condition-gated, by its OWN conditions or an ancestor's.
   *
   * Inherited down the walk because a reader prunes whole SUBTREES: a conditioned container takes
   * its children with it. A node judged only by its own conditions therefore leaves an
   * unconditional child's rules in the main sheet while that child's markup is withheld —
   * publishing the colours, fonts and `url(...)` of an element nobody was served.
   */
  gated: boolean;
}

/**
 * Every node in the document, each with the pointer that reaches it.
 *
 * The pointer is built during the walk rather than counted, because a warning's
 * path is a promise that it resolves into the document being compiled: a node
 * inside a slot lives at `/nodes/0/slots/children/1`, and numbering nodes in
 * visit order would produce a path that reaches a different node or none at all.
 */
/**
 * Whether a caller's predicate says this node draws nothing, contained.
 *
 * `compilePageCss` is exported, so the predicate is a consumer's function
 * running with nothing above it to catch a failure: a throw would abort the
 * whole compile rather than cost one node its exemption, and a mistakenly
 * `async` one returns a promise that compares unequal to `true` while leaving a
 * rejection nobody handles — which Node reports and can end the process with.
 *
 * Anything short of an explicit `true` counts as drawing, so a predicate that
 * cannot be trusted keeps a node's rules in the sheet rather than removing
 * styling from something that is on the page.
 */
function containedDrawsNothing(
  predicate: ((node: BlockNode) => boolean) | undefined,
  node: BlockNode
): boolean {
  if (predicate === undefined) return false;
  let answer: unknown;
  let deferred = false;
  try {
    answer = predicate(node);
    // Read inside the guard: a throwing `then` getter on the returned value
    // would otherwise escape on its way to being caught.
    deferred =
      typeof (answer as { then?: unknown } | undefined)?.then === "function";
  } catch {
    return false;
  }
  if (deferred) {
    void Promise.resolve(answer).catch(() => undefined);
    return false;
  }
  return answer === true;
}

function documentNodes(
  doc: BlockDocument,
  warnings: ValidationIssue[],
  warningAllowance: WarningAllowance,
  limits: DocumentLimits = DEFAULT_LIMITS,
  drawsNothing?: (node: BlockNode) => boolean
): PlacedNode[] {
  // WHICH nodes are read is `selectNodes`, shared with every other reader of a
  // stored document, because two readers stopping in different places is not a
  // difference anyone sees until a class is deleted off a page still rendering
  // it. What this function adds is the part only styling needs: the gating a
  // node inherits, and how to phrase the limit for an author.
  const selection = selectNodes(doc, limits);

  if (selection.stopped !== undefined) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: selection.stopped.path,
      code: "node-count-exceeded",
      severity: "warning",
      message:
        selection.stopped.reason === "depth"
          ? `Nodes below depth ${selection.stopped.limit} were not styled, because the document nests deeper than a document may.`
          : `Only the first ${selection.stopped.limit} nodes were styled, because the document holds more than a document may.`,
    });
  }

  const saysItDrawsNothing = (node: BlockNode): boolean =>
    containedDrawsNothing(drawsNothing, node);

  const placed: PlacedNode[] = [];
  for (const entry of selection.nodes) {
    // Once gated, gated for the whole subtree: a descendant cannot be served
    // when the ancestor carrying it is not. A block that draws nothing takes
    // its slots with it for the same reason — a slot's children are placed by
    // the markup the block returns, and a block returning nothing places none
    // of them.
    //
    // Read from the parent already placed rather than carried down the walk.
    // Level order puts a parent before its children, so by the time a child is
    // reached its parent's verdict is final.
    const inherited = entry.parent === -1 ? false : placed[entry.parent].gated;
    placed.push({
      node: entry.node,
      path: entry.path,
      gated:
        inherited ||
        isConditionGated(entry.node) ||
        saysItDrawsNothing(entry.node),
    });
  }
  return placed;
}

/**
 * Compile a document's styles.
 *
 * The tiers, in the order they are emitted and therefore in the order they
 * override one another: page settings, block-type defaults, the site's named
 * classes in library order, then each node's own values. A whole tier precedes
 * the whole of the next, so a node's value beats a class's at any breakpoint.
 *
 * Two tiers named in the cascade are still absent. Design tokens are defined by
 * data this signature does not take yet, and user custom CSS has to be sanitized
 * before it can be written at all, so writing it before that exists would be the
 * one hole nothing else in this design leaves open.
 */
export function compilePageCss(
  doc: BlockDocument,
  ctx: StyleCompileContext
): CompiledPageCss {
  const warnings: ValidationIssue[] = [];
  // One allowance for the whole compile. Per style map it would reset, and a
  // document with a long slot key and many bad values would answer with output
  // quadratic in its own size.
  const budget = newStyleIssueBudget();
  // Bounded separately from the budget above, so a settings record full of
  // stale ids — or a document full of malformed token names — costs its own
  // diagnostics and not the page's stylesheet.
  const warningAllowance = newWarningAllowance();
  /*
   * Normalised ONCE for the whole compile, so the contexts and the visibility
   * bands cannot disagree about it. Two readers of one raw field is how a
   * refused name would have reached one path and not the other, and the sheet
   * would then mix previewed styles with published bands.
   */
  const preview = previewContainerName(ctx.previewContainer);
  const contexts = breakpointContexts(ctx.breakpoints, {
    ...(preview === undefined ? {} : { previewContainer: preview }),
  });
  const tokenPrefix = ctx.tokenPrefix ?? DEFAULT_TOKEN_PREFIX;
  const mayFetchUrl = ctx.mayFetchUrl;
  const scope = scopeSelector(ctx.scope, warnings);
  // What was WRITTEN, which is not always what was asked for: a scope this
  // compiler refuses is dropped and the sheet compiled global, and a caller that
  // recorded the request would store an artifact claiming an isolation its own
  // selectors do not carry.
  const effectiveScope = scope === "" ? undefined : ctx.scope;
  const pageRoot = `${PAGE_ROOT_SELECTOR}${scope}`;
  // The SINGLE page-root class, for the tiers that must not borrow the
  // doubling. `PAGE_ROOT_SELECTOR` repeats the class so an author's values
  // outrank host CSS; a default anchored to one class weighs `0-1-0`, which
  // clears a bare element reset and still yields to a host's own class rule.
  //
  // A scope CONSTRAINS this anchor without adding to it. Appended plainly the
  // pair weighs `0-2-0`, and a default that outranks a host's `.content h1`
  // (`0-1-1`) is no longer something the site can override — so a scoped
  // document would keep defaults precisely where an unscoped one yields, which
  // is the opposite of what scoping means. Inside `:where()` the class still
  // has to match and contributes nothing, so both documents weigh the same.
  const defaultsAnchor =
    scope === ""
      ? `.${PAGE_ROOT_CLASS}`
      : `.${PAGE_ROOT_CLASS}:where(${scope})`;

  const nodes = documentNodes(
    doc,
    warnings,
    warningAllowance,
    ctx.limits,
    ctx.drawsNothing
  );
  const classes = nodeClassNames(nodes.map(entry => entry.node.id));
  // Two nodes sharing an id share a class, because a class is derived from the
  // id and the map this returns is keyed by it — there is no second class to
  // give the second node, and no way to tell a renderer about one. So their
  // styles are refused rather than emitted: written, both envelopes would land
  // on the one selector and the later would silently restyle BOTH elements, one
  // of which never asked for it. Refusing costs the styling of two nodes and
  // says so; writing corrupts a node the author did not touch.
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const { node } of nodes) {
    const id = node.id;
    if (typeof id !== "string") continue;
    if (seenIds.has(id)) duplicateIds.add(id);
    seenIds.add(id);
  }

  const rules: CssRule[] = [];
  // A null-prototype record, because a node id is author data and `__proto__` is a legal one.
  // Assigning it on an ordinary object runs the inherited setter instead of creating an own
  // property, so the entry vanishes: `Object.keys` stays empty, the field is omitted as though the
  // page gated nothing, and a reader then treats a fresh artifact as one compiled before the split
  // and withholds the WHOLE sheet — every visible sibling losing its styling because one node was
  // named `__proto__`.
  const gated: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  // One array for the whole compile, appended to in emission order by every tier below.
  const trace: StyleTraceEntry[] | undefined =
    ctx.trace === true ? [] : undefined;

  // Page-scoped values, on the root every other selector is anchored to. First
  // because it is the outermost element: what it sets is what everything inside
  // inherits before any block has said anything.
  rules.push(
    ...envelopeRules(
      doc.settings?.styles,
      pageRoot,
      "/settings/styles",
      contexts,
      tokenPrefix,
      warnings,
      budget,
      warningAllowance,
      { origin: { kind: "page" }, trace, mayFetchUrl }
    )
  );

  // Element defaults, below block defaults and above nothing. A tag reaches a
  // SELECTOR exactly as a block type does, so it is held to a closed list
  // rather than escaped: these are the elements the block library renders text
  // as, and a caller naming anything else is not describing this document's
  // typography. An allow-list rather than a grammar, because the set is small,
  // known, and has no reason to grow without someone deciding it should.
  const elements = ctx.elementBases ?? {};
  for (const tag of TYPOGRAPHIC_ELEMENTS) {
    if (!Object.hasOwn(elements, tag)) continue;
    rules.push(
      ...envelopeRules(
        elements[tag],
        tag,
        pointer("/elementBases", tag),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        warningAllowance,
        {
          origin: { kind: "element", tag },
          trace,
          mayFetchUrl,
          weightlessAnchor: defaultsAnchor,
        }
      )
    );
  }

  // One rule per block type present, not per node using it.
  const usedTypes = new Set<string>();
  for (const { node } of nodes) {
    if (typeof node.type === "string") usedTypes.add(node.type);
  }
  const bases = ctx.blockBases ?? {};
  for (const type of [...usedTypes].sort()) {
    if (!Object.hasOwn(bases, type)) continue;
    // A node type reaches a SELECTOR, and this compiler reads persisted data
    // whether or not a caller validated it. Unchecked, `"evil/x, body"` emits
    // `.nx-pb-page .nx-bt-evil--x, body { … }` — a second selector of the
    // author's choosing, applying a block's defaults to every `body` on the
    // page, and more hostile spellings close the rule and open their own.
    //
    // Held to the same grammar the document model defines for a node type
    // rather than escaped into something safe: a type that is not a namespaced
    // slug is not a type this engine can style, and quietly renaming it would
    // emit a class no renderer will ever put on an element.
    if (!isBlockType(type)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer("/blockBases", type),
        code: "invalid-node-type",
        severity: "warning",
        message: `"${describeValue(type)}" is not a block type, so its default styles were not written.`,
        suggestion: 'Use a namespaced slug such as "core/section".',
      });
      continue;
    }
    rules.push(
      ...envelopeRules(
        bases[type],
        // Escaped as well as refused above. The check is what makes this safe;
        // escaping is what keeps it safe if the check is ever loosened, and it
        // changes nothing for a type that passed, whose characters are all
        // legal in a class already.
        `.${escapeIdentifier(blockTypeClassName(type))}`,
        pointer("/blockBases", type),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        warningAllowance,
        {
          origin: { kind: "blockType", type },
          trace,
          mayFetchUrl,
          weightlessAnchor: defaultsAnchor,
        }
      )
    );
  }

  // The named classes, in library order — the tier between a block's defaults and a node's own
  // values. At one specificity the cascade is source order, so being emitted here IS what makes
  // a class beat the block default and lose to a local value.
  //
  // `usableNamedClassPositions` decides which of them are written, and the class list handed
  // each node is built from that same call, so a class dropped here is dropped from both.
  //
  // Charged against an allowance of their own, one per class. A site's class library is one
  // document's configuration and every document's problem, so neither wider budget will do:
  // sharing the NODE budget lets a malformed library entry spend it before any node is reached,
  // and sharing one budget across the whole tier lets a single unreferenced entry spend it before
  // any later class is read. Either way one bad entry strips styling from a page that never
  // referenced it.
  // The library is one site-settings record read by every page compile, and it arrives whether or
  // not anything validated it. A non-array — `{}` from a corrupt row — reaches a spread inside
  // `orderedNamedClasses` and throws, which would take down rendering for every page on the site
  // rather than costing the styling of the classes nobody can read.
  const storedLibrary: unknown = ctx.namedClasses;
  // Bounded BEFORE anything copies, sorts or scans it. The library is site-level persisted data
  // read on every page render, and a corrupt settings row holding a very large array would be
  // allocated and sorted in full each time — the document walk is capped and the warnings are
  // capped, so this was the one unbounded read left on the path.
  const wholeLibrary: readonly NamedClass[] = Array.isArray(storedLibrary)
    ? (storedLibrary as readonly NamedClass[])
    : [];
  const library =
    wholeLibrary.length > MAX_NAMED_CLASSES
      ? wholeLibrary.slice(0, MAX_NAMED_CLASSES)
      : wholeLibrary;
  if (library.length < wholeLibrary.length) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: "/classes",
      code: "invalid-class-library",
      severity: "warning",
      message: `The site's class library holds ${wholeLibrary.length} classes; only the first ${MAX_NAMED_CLASSES} were read.`,
      suggestion: "Remove the classes the site no longer uses.",
    });
  }
  if (storedLibrary !== undefined && !Array.isArray(storedLibrary)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: "/classes",
      code: "invalid-class-library",
      severity: "warning",
      message: `The site's class library is ${describeValue(storedLibrary)} rather than a list, so no named class was written.`,
      suggestion: "Store the class library as an array of classes.",
    });
  }
  // Which SLOTS were written, not which ids and not which entries. Two entries can carry one id,
  // and one object can be supplied in two slots: asking "was this id written" answers yes for the
  // entry that was dropped, and asking "was this ENTRY written" answers yes for the slot that was
  // dropped. Both go unreported, which is the exact case this reporting exists to explain.
  const writtenPositions = usableNamedClassPositions(library);
  const written = new Set<number>(writtenPositions);
  const usableClasses = writtenPositions.map(position => library[position]);
  // The ids the written classes claimed, so an entry dropped for sharing one can be told that
  // rather than being told its name collided.
  const usedIds = new Set(usableClasses.map(cls => cls.id));
  // Where each entry sits in the stored array, so a warning can point at the entry rather than at
  // a name derived from it. A pointer built from the id does not resolve — the id may be missing,
  // may not be a string, and is exactly what is unreliable about a malformed entry — so an editor
  // could not highlight the class it is describing.
  //
  // Walked as POSITIONS rather than entries, because the entries reported on here are the ones
  // the library could not use and those can be primitives: `[null, null]` is two entries needing
  // two separate repairs, and a lookup keyed by the entry answers with the first position for
  // both, sending an editor to a class it has already fixed.
  const orderedPositions = orderedNamedClassPositions(library);
  for (const position of orderedPositions) {
    const cls = library[position];
    if (written.has(position)) continue;
    // Reported once per entry the library could not use, naming which of the three reasons it
    // was. A usable record whose name is free is not reachable here, so the remaining case after
    // the two structural ones is a name another class already took.
    //
    // Read in this order because the reasons are not alternatives: an entry can be malformed AND
    // collide, and a name that cannot be written is the one an author can act on without first
    // being told the wrong thing. Collapsing the middle case into the collision — which the
    // presence of a valid slug alone would do — tells the author to rename a class whose name was
    // never the problem, and renaming it fixes nothing.
    const slug = readClassSlug(cls);
    const id = readClassId(cls);
    const named =
      typeof slug !== "string" ||
      // Length before the pattern, and read as a NAME problem. An oversized slug is refused by
      // `isUsableNamedClass`, so falling through to the structural branch told an author their id
      // or styles were missing when the name was the whole of it — and ran the pattern over the
      // corrupt string first to get there.
      slug.length > MAX_NAMED_CLASS_NAME_LENGTH ||
      !NAMED_CLASS_SLUG_RE.test(slug)
        ? {
            code: "invalid-class-name" as const,
            message: `A named class could not be written: ${describeValue(slug)} is not a class name.`,
            suggestion: 'Use a lowercase slug such as "card-featured".',
          }
        : !isUsableNamedClass(cls)
          ? {
              code: "invalid-class" as const,
              message: `The class named "${describeValue(slug)}" is missing its id or its styles, so it was not written.`,
              suggestion: "Give every class a string id and a styles record.",
            }
          : // A usable record that survived neither claim lost one of them. The id is checked
            // first because it is the one a document references: told only that the NAME
            // collided, an author renames a class and the reference still reaches the other one.
            typeof id === "string" && usedIds.has(id)
            ? {
                code: "duplicate-class-id" as const,
                message: `More than one class carries the id ${describeValue(id)}, so only the first was written.`,
                suggestion: "Give every class a distinct id.",
              }
            : {
                code: "duplicate-class-name" as const,
                message: `More than one class is named "${describeValue(slug)}", so only the first was written.`,
                suggestion: "Give every class a distinct name.",
              };
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer("/classes", String(position)),
      severity: "warning",
      ...named,
    });
  }
  for (const position of writtenPositions) {
    const cls = library[position];
    rules.push(
      ...envelopeRules(
        cls.styles,
        `${pageRoot} .${escapeIdentifier(namedClassName(cls.slug))}`,
        // The envelope is stored under `styles`, so the pointer names it. Without that a warning
        // reads `/classes/0/base/base/bogus`, which resolves to nothing an editor can open.
        pointer(pointer("/classes", String(position)), "styles"),
        contexts,
        tokenPrefix,
        warnings,
        // One WRITE budget per class, not one for the tier. Shared, a single unreferenced entry
        // with enough invalid properties spends it and every later class is refused unread — so a node
        // referencing a perfectly good class receives its token and no declarations, styled by a
        // library entry it never mentions. The tier's total output stays bounded by the warning
        // allowance, which is shared and is what actually caps the reporting.
        newStyleIssueBudget(),
        warningAllowance,
        {
          origin: { kind: "class", id: cls.id, slug: cls.slug },
          trace,
          mayFetchUrl,
        }
      )
    );
  }

  // Each node's own values, in document order so the stylesheet reads the way
  // the page does.
  const reportedDuplicates = new Set<string>();
  for (const { node, path, gated: nodeGated } of nodes) {
    const className = classes.get(node.id);
    if (className === undefined) continue;
    if (duplicateIds.has(node.id)) {
      // Once per id rather than once per node carrying it: the second report
      // would name the same defect and the same fix.
      if (!reportedDuplicates.has(node.id)) {
        reportedDuplicates.add(node.id);
        pushBoundedWarning(warningAllowance, warnings, {
          path: pointer(path, "id"),
          code: "duplicate-node-id",
          severity: "warning",
          message: `More than one node has the id "${describeValue(node.id)}", so they cannot be styled apart and none of their styles were written.`,
          suggestion: "Give every node a unique id.",
        });
      }
      continue;
    }
    const selector = `${pageRoot} .${className}`;
    const traceBeforeNode = trace?.length ?? 0;
    const nodeRules = [
      ...envelopeRules(
        node.styles,
        selector,
        pointer(path, "styles"),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        warningAllowance,
        { origin: { kind: "node", id: node.id }, trace, mayFetchUrl }
      ),
      ...visibilityRules(
        node,
        selector,
        contexts,
        path,
        warnings,
        warningAllowance,
        preview
      ),
    ];
    // Held out of the sheet when the node can be pruned at read time. Serialized on its own, so
    // each entry carries whatever at-rules its own contexts opened and a reader can append it
    // without reading what came before. Appending is safe because every node carries its own
    // hashed class: two nodes' local rules never collide, and tier order is preserved inside
    // each entry.
    if (nodeGated) {
      gated[node.id] = serializeRules(nodeRules);
      // The trace has to describe the sheet that was RETURNED. `envelopeRules` appended this
      // node's declarations while building them, and they are now leaving `css` — so left in
      // place they would report declarations the browser never received, at an interleaved
      // position the appended entry does not occupy either. Rolled back to where this node
      // started rather than filtered afterwards, because the entries carry no marker saying
      // which node produced them.
      if (trace !== undefined) trace.length = traceBeforeNode;
      continue;
    }
    rules.push(...nodeRules);
  }

  // The classes a renderer puts on each node, which is not the same as the class this compiler
  // styles it by. A `.nx-c-*` rule reaches an element only if the element carries that token, so
  // returning the node class alone would emit the whole named-class tier and leave every rule in
  // it inert — styles written, referenced, and applying to nothing.
  //
  // Narrowed through `usableClasses` for the same reason resolution is: a class the stylesheet
  // dropped must not be put on an element, where it would match a rule some other class owns.
  const byId = new Map(usableClasses.map(cls => [cls.id, cls]));

  /**
   * Whether a stored reference could name a class at all.
   *
   * Length first, and before the value is hashed. A Set or a Map reads a string key in full to
   * hash it, so an unvalidated node holding a megabyte-long id would pay that on every render —
   * once to dedupe, once to look it up, once to apply it — for a value no class can carry, since
   * `isUsableNamedClass` caps an id at the same bound.
   */
  const couldNameAClass = (id: unknown): id is string =>
    typeof id === "string" && id.length <= MAX_NAMED_CLASS_NAME_LENGTH;
  const attributeClasses = new Map<string, string>();
  const reportedMissingClasses = new Map<string, Set<string>>();
  for (const { node, path } of nodes) {
    const own = classes.get(node.id);
    if (own === undefined) continue;
    const names = [own];
    // A stored `classes` that is not a list — `"c1"` rather than `["c1"]` — references nothing
    // this compiler can apply. Normalized away in silence it leaves an author with classes in the
    // document, none on the element, and no account of either.
    if (node.classes !== undefined && !Array.isArray(node.classes)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer(path, "classes"),
        code: "invalid-classes",
        severity: "warning",
        message: `The classes on this node are ${describeValue(node.classes)} rather than a list, so none were applied.`,
        suggestion: "Store node classes as an array of class ids.",
      });
    }
    const stored: readonly unknown[] = Array.isArray(node.classes)
      ? node.classes
      : [];
    // Deduped once, bounded as it is read, and reused by both walks below. Each of them built its
    // own set straight from the stored array, so a node holding a very large `classes` list was
    // copied twice per render before either the warning allowance or the library lookup could cap
    // anything — and a document is unvalidated data, so that list is whatever was persisted.
    //
    // The bound counts entries READ rather than distinct ids kept: a list of a million copies of
    // one id allocates nothing either way, but only a read bound stops it being scanned.
    // Each entry keeps the position it was stored at, so a warning about one of them resolves to
    // the reference rather than to the whole array. Deduping by id alone loses that, and an
    // editor following the pointer can then neither highlight nor remove what it names.
    const applied: Array<{ id: unknown; index: number }> = [];
    const seenIds = new Set<unknown>();
    const readLimit = Math.min(stored.length, MAX_CLASSES_PER_NODE);
    for (let index = 0; index < readLimit; index += 1) {
      const id = stored[index];
      // A string too long to name a class is not deduped, because deduping is what reads it in
      // full. It is still kept, so it is still accounted for — reported once at each position it
      // was stored at, which the per-node entry cap already bounds.
      const tooLongToName =
        typeof id === "string" && id.length > MAX_NAMED_CLASS_NAME_LENGTH;
      if (!tooLongToName) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      applied.push({ id, index });
    }
    if (stored.length > MAX_CLASSES_PER_NODE) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer(path, "classes"),
        code: "too-many-classes",
        severity: "warning",
        message: `This node lists ${stored.length} classes; only the first ${MAX_CLASSES_PER_NODE} were applied.`,
        suggestion:
          "Remove the references the node no longer needs, or combine them into one class.",
      });
    }
    for (const { id, index } of applied) {
      if (couldNameAClass(id) && byId.has(id)) continue;
      const entryPath = pointer(pointer(path, "classes"), index);
      // A value that is not a string is not a class id the library could ever define, so telling
      // an author to add it there sends them to fix something that cannot be fixed that way. The
      // same shape validation calls malformed, called malformed here too.
      if (!couldNameAClass(id)) {
        pushBoundedWarning(warningAllowance, warnings, {
          path: entryPath,
          code: "invalid-classes",
          severity: "warning",
          message: `This node lists ${describeValue(id)} as a class, which is not a class id, so it was not applied.`,
          suggestion: "Store node classes as an array of class-id strings.",
        });
        continue;
      }
      // A reference that reached nothing. Silently dropping it leaves an author with a class on
      // the node, no class on the element, and nothing connecting the two — the same account
      // every other unwritten value in this compile gets. Once per id, because a second report
      // would name the same missing class and the same fix.
      // A set per stored node, because the pointer above names one reference and a reference is
      // per node. Deduped across the document, the first node to list a missing class takes the
      // only report, and an author who follows that pointer and repairs it hears nothing about
      // the others. Nested rather than keyed on a joined string, so no separator has to be a
      // character an id cannot contain.
      //
      // Keyed by the node's PATH, not its id. A forgiving compile reads a document whose ids may
      // repeat, and two nodes sharing one would then share a set — collapsing exactly the reports
      // this split apart. A path is the position in the document, so it is one per stored node
      // however corrupt the ids are.
      //
      // On the RAW id, because `describeValue` truncates and would collapse two distinct
      // references into one report. The message still uses the described form: an unvalidated
      // document can carry an enormous id, and the allowance charges paths rather than message
      // text, so interpolating the raw one returns a diagnostic its size.
      const reportedHere =
        reportedMissingClasses.get(path) ?? new Set<string>();
      reportedMissingClasses.set(path, reportedHere);
      if (reportedHere.has(id)) continue;
      reportedHere.add(id);
      pushBoundedWarning(warningAllowance, warnings, {
        path: entryPath,
        code: "unknown-class",
        severity: "warning",
        message: `This node lists the class ${describeValue(id)}, which the site library does not define, so it was not applied.`,
        suggestion: "Remove the reference, or add the class to the library.",
      });
    }
    // Two nodes sharing an id share one entry in this map, so a named class recorded here would
    // either be lost by whichever node is written second or applied to both. Refused for the
    // same reason their rules are: a class the author put on one node must not silently restyle
    // another node that never referenced it.
    if (!duplicateIds.has(node.id)) {
      // Library order, not the order the node lists them in, so the value is stable for a caching
      // renderer and reads the way the stylesheet does.
      for (const cls of orderedNamedClasses(
        applied
          // A stored reference that is not a string names nothing the library can hold, and was
          // already reported above as malformed.
          .map(entry =>
            couldNameAClass(entry.id) ? byId.get(entry.id) : undefined
          )
          .filter((cls): cls is NamedClass => cls !== undefined)
      )) {
        names.push(namedClassName(cls.slug));
      }
    }
    attributeClasses.set(node.id, names.join(" "));
  }

  return {
    ...(effectiveScope === undefined ? {} : { scope: effectiveScope }),
    // The NORMALISED name, so a refused one leaves this absent and the artifact
    // reads as the published sheet it actually is.
    ...(preview === undefined ? {} : { previewContainer: preview }),
    css: serializeRules(rules),
    warnings,
    classes: attributeClasses,
    // Omitted rather than empty when nobody asked, so a caller cannot mistake "not requested"
    // for "nothing was written".
    ...(trace === undefined ? {} : { trace }),
    // Omitted when the document gates nothing, so a page without conditions compiles to exactly
    // the shape it did before this field existed.
    ...(Object.keys(gated).length === 0 ? {} : { gated }),
  };
}
