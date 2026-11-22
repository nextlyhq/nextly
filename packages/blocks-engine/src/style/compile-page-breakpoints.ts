/**
 * Breakpoints as the compiler writes them: each breakpoint's at-rule, the
 * container a preview is drawn in and its name, the scope a document's rules
 * are confined to, and the warnings for values keyed to a breakpoint the site
 * does not define.
 *
 * @module style/compile-page-breakpoints
 */
import {
  type BreakpointDef,
  type BreakpointSet,
  MAX_BREAKPOINT_ID_LENGTH,
  MAX_BREAKPOINTS_PER_AXIS,
  type NodeStyles,
  STYLE_STATES,
  type StyleState,
} from "../document";
import { describeValue, pointer } from "../issue-text";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import { BREAKPOINT_AXES, type BreakpointAxis } from "./breakpoint-axes";
import { escapeIdentifier } from "./css-value";
import {
  allowanceSpent,
  pushBoundedWarning,
  type WarningAllowance,
} from "./warning-allowance";

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

export function queryPrefix(
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
export const UNSATISFIABLE_CONDITION = "(width < 0px)";

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
// RELOCATED, not written here — see the docblock of `compile-page.ts`.
// fallow-ignore-next-line complexity
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
export function scopeSelector(
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

// RELOCATED, not written here — see the docblock of `compile-page.ts`.
// fallow-ignore-next-line complexity
export function unknownBreakpointWarnings(
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
