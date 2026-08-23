/**
 * The identity of the SHARED style inputs a page was compiled against.
 *
 * A stored page stylesheet is a cache of a compile, and a cache is sound only
 * when it is keyed on every input that compile used. `fetchPolicyId` keys one of
 * them. Four more are site-level, shared by every page, and can move underneath
 * a stored artifact with nothing noticing:
 *
 * - **breakpoints**, whose ids and bounds decide the at-rules every tier is
 *   emitted under;
 * - **the token prefix**, which renders into every `var(--<prefix><name>)` the
 *   sheet references;
 * - **the named-class library**, whose slugs become the selectors themselves and
 *   whose styles ARE the rules a page carries for them;
 * - **the block-type defaults**, which the compiler emits into this same page
 *   sheet — and emits AFTER the site sheet, so a stale base rule here overrides
 *   an updated one there rather than merely disagreeing with it.
 *
 * When one moves, the newly compiled site sheet and the stored page sheet stop
 * agreeing, and CSS fails silently in exactly the wrong direction: an unresolved
 * custom property invalidates its declaration rather than reporting, and a
 * selector nothing declares simply never matches. The page renders, unstyled in
 * part, with no error anywhere.
 *
 * ## Why this is a digest and `fetchPolicyLabel` is not
 *
 * That function returns the canonical serialization ITSELF, which is legible and
 * needs no hash. It can afford to because a remote-pattern list is short. This
 * one cannot: a class library is bounded at `MAX_NAMED_CLASSES` entries whose
 * slugs alone reach `MAX_NAMED_CLASS_NAME_LENGTH`, and each carries its whole
 * style envelope — so the serialization runs to hundreds of kilobytes at the
 * ceiling, and it would be stored on EVERY page artifact rather than once.
 *
 * So the stamp is a digest over that serialization. The canonicalisation is
 * unchanged and keeps every rule the label established, because that is where
 * correctness lives — hashing is a lossy projection over the string and does not
 * excuse a weaker string.
 *
 * ## Why the digest is not cryptographic
 *
 * The question this answers is "did the shared inputs move", not "is this stamp
 * authentic". Nothing is gained by forging a collision: the worst a collision
 * does is skip a recompile that would have produced the same sheet, and an
 * attacker who can write the site's class library has already changed the CSS
 * directly. Against that threat model a cryptographic hash buys nothing and
 * costs a great deal — `node:crypto` is not among this package's three allowed
 * runtime imports, and `crypto.subtle` is asynchronous while every caller here
 * is not.
 *
 * The digest is the engine's own `hashId` rather than one written here. It
 * already content-addresses a compiled site sheet, so this is the question it
 * was built for, and it states its own non-cryptographic bound. A second hash
 * beside it would be a second answer to how this repository fingerprints
 * compiled CSS.
 *
 * @module shared-style-inputs
 */
import {
  MAX_NAMED_CLASSES,
  hashId,
  orderedNamedClasses,
} from "@nextlyhq/blocks-engine";
import type {
  BreakpointSet,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";

/**
 * The inputs this module reads, which is less than a compile context holds.
 *
 * Narrowed so a caller can stamp without constructing one, and so the fields
 * that DO decide a stamp are visible in one place rather than inferred from a
 * much larger interface.
 */
export type SharedStyleInputs = Pick<
  StyleCompileContext,
  "breakpoints" | "namedClasses" | "tokenPrefix" | "blockBases"
>;

/** A value the stamp may read fields from without dereferencing a non-object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The encoding this module produces, carried inside every stamp.
 *
 * A later change to what is serialized, or to how, makes old stamps describe a
 * different question — and comparing them would silently reuse artifacts nobody
 * re-judged. Bumping this invalidates them instead, which costs one recompile
 * each and is the safe direction.
 */
const ENCODING = "v1";

/**
 * The identity of shared inputs that decline to identify themselves.
 *
 * Deliberately not valid digest output: every stamp this module produces is
 * `v1:` followed by hex, and this contains neither, so no stored stamp can
 * equal it. That makes "compiled when the inputs were unknowable" mean
 * recompile every time.
 *
 * The asymmetry that forces a sentinel rather than absence is the one
 * `UNIDENTIFIED_FETCH_POLICY` already documents: absence is ALSO the honest
 * stamp for a compile with no shared inputs at all, so the two would compare
 * equal while meaning opposite things — and the artifact that loses is the one
 * compiled under real inputs, which would be reused under none.
 *
 * Storage-safe on purpose: it is written onto a recompiled artifact and into a
 * JSON column, so it carries no control characters.
 */
export const UNIDENTIFIED_SHARED_INPUTS = "unidentified-shared-inputs";

/**
 * One breakpoint, reduced to what reaches the stylesheet.
 *
 * `label` is deliberately absent. It is the author's word for the breakpoint and
 * never reaches CSS — the at-rule is built from `maxWidth` alone — so including
 * it would recompile every page on the site when someone renames "Tablet" to
 * "Medium", which is a cost with no correctness behind it.
 *
 * Order is preserved rather than canonicalised, and unlike the class library
 * that is deliberate rather than an oversight.
 *
 * The compiler sorts each axis by descending `maxWidth`, so a reorder of
 * DISTINCT widths changes nothing it emits and this stamp moves for no reason —
 * a cost, paid as one site-wide recompile after a harmless settings rewrite.
 * Reproducing that sort here would remove the cost and is refused for a
 * different reason: the comparator is a local inside `compilePageCss` and not
 * exported, so a copy could drift from the ordering that decides the output.
 *
 * And it could not be a blanket sort in any case. The comparator returns 0 for
 * equal widths and `Array.prototype.sort` is stable, so two breakpoints sharing
 * a `maxWidth` keep their STORED order and genuinely emit differently. An
 * order-independent stamp would miss that, which is the silent direction; this
 * one over-invalidates instead, which is only expensive.
 */
function breakpointParts(set: BreakpointSet | undefined): unknown {
  const axis = (defs: BreakpointSet["viewport"] | undefined) =>
    // An OBJECT rather than a tuple, because the two spellings of "no bound"
    // are not the same input and an array cannot keep them apart —
    // `JSON.stringify([undefined])` is `[null]`. On a container axis an ABSENT
    // `maxWidth` compiles to `@container (min-width: 0)`, the widest query,
    // while a stored `null` is a different value the compiler does not treat
    // that way. Omitting the key when it is absent and keeping it when it is
    // null is the same distinction `fetchPolicyLabel` relies on.
    (Array.isArray(defs) ? defs : []).map(def =>
      isRecord(def)
        ? {
            id: def.id,
            ...(def.maxWidth === undefined ? {} : { maxWidth: def.maxWidth }),
          }
        : null
    );
  return [axis(set?.viewport), axis(set?.container)];
}

/**
 * One class, reduced to what reaches the stylesheet — which is all of it.
 *
 * Every field decides output: `slug` becomes the selector, `orderIndex` decides
 * which class wins where two apply, `styles` are the declarations themselves,
 * and `id` is what a document references and what the emitted class map keys.
 * This is why the serialization is large and therefore why it is digested.
 *
 * `styles` goes through `JSON.stringify` as a whole rather than being walked.
 * A walk here would be a second reading of the style envelope beside the
 * compiler's own, and the two would drift the first time either learned a field.
 */
/**
 * One class's styles, reduced to a digest of their whole serialization.
 *
 * DIGESTED rather than carried, because the label holds one entry per class and
 * a library runs to `MAX_NAMED_CLASSES`: carrying the envelopes would build a
 * string the size of the site's whole class configuration on every render, and
 * then hash that.
 *
 * Digested rather than TRUNCATED, which is what this did first and was strictly
 * worse. Truncating the serialized text bounds the label but not the work —
 * `JSON.stringify` has already materialised the entire string before anything
 * can slice it — so it paid the allocation anyway and gave up sensitivity for
 * it: two envelopes differing only past the cut, at the same length, stamped
 * alike while the compiler emitted different CSS. Hashing bounds the label the
 * same way and every character reaches the digest.
 *
 * The guard stays. This library is one settings record read on every render and
 * arrives unvalidated, so a circular value must cost this entry's precision
 * rather than the render: `compilePageCss` skips a corrupt entry with a warning,
 * and throwing here would take down every page on the site before it ran.
 */
function styleEnvelope(styles: unknown): unknown {
  try {
    return hashId(JSON.stringify(styles ?? null) ?? "null");
  } catch {
    // Unserialisable — circular, or a value with a throwing `toJSON`. A constant
    // is safe because such an envelope cannot compile either.
    return "unserialisable";
  }
}

function classParts(entry: unknown): unknown {
  // A malformed entry is reduced rather than dereferenced. This library is one
  // site-settings record read on every page render, and it arrives whether or
  // not anything validated it — `compilePageCss` treats a corrupt entry as
  // untrusted and skips it with a warning rather than failing the render, and a
  // stamp that threw on the same row would take down every page on the site
  // instead of costing one class its styling.
  //
  // `null` rather than omission, so a corrupt entry still occupies its position:
  // dropping it would let a library gain a bad row and stamp identically.
  if (!isRecord(entry)) return null;
  return [
    entry.id,
    entry.slug,
    entry.orderIndex,
    styleEnvelope(entry.styles),
  ] as unknown;
}

/**
 * The canonical serialization the stamp is taken over.
 *
 * Exported because a digest that changed with no way to say why is the standing
 * failure mode of a cache key: when an artifact recompiles unexpectedly, this is
 * what answers which input moved. It is not written to storage — the stamp is.
 *
 * Members are written out in a fixed order rather than serialized from an
 * object, so two equal inputs cannot serialize differently because they were
 * built in a different order. `JSON.stringify` keeps an absent field and an
 * empty one apart, which matters for `tokenPrefix`: unset means the engine's own
 * default, and `""` means a site that deliberately declared no prefix, and those
 * compile to different custom-property names.
 */
export function sharedStyleInputsLabel(inputs: SharedStyleInputs): string {
  // Bounded exactly as the compiler bounds it. `compilePageCss` reads only the
  // first `MAX_NAMED_CLASSES` entries, so entries past that cap reach no
  // stylesheet and must not move a stamp — and an oversized settings row must
  // not restore, here, the unbounded allocation the compiler's cap exists to
  // prevent.
  const library = Array.isArray(inputs.namedClasses) ? inputs.namedClasses : [];
  return JSON.stringify([
    ENCODING,
    breakpointParts(inputs.breakpoints),
    inputs.tokenPrefix ?? null,
    // Ordered by the ENGINE'S own comparator rather than as stored, because the
    // compiler sorts the library before emitting it — so two storage orders of
    // the same classes produce identical CSS and must produce identical stamps.
    // Imported rather than restated: a comparator copied here would drift from
    // the one that decides the output, and the drift would be silent in both
    // directions.
    orderedNamedClasses(library.slice(0, MAX_NAMED_CLASSES)).map(classParts),
    // The block-type defaults, which the renderer resolves beside the other
    // three and the compiler emits into this very sheet. Keyed by type, so
    // `JSON.stringify` of the record is stable only if the keys are — hence the
    // sort, which is the one place order is imposed rather than preserved: a
    // record has no meaningful order and two equal sets must not stamp apart.
    Object.keys(inputs.blockBases ?? {})
      .sort()
      .map(type => [type, (inputs.blockBases ?? {})[type] ?? null]),
  ]);
}

/**
 * The stamp to write onto an artifact and to compare a stored one against.
 *
 * `undefined` when the caller stated no shared inputs at all — which is a real
 * answer meaning "this compile used none", not a refusal. A caller that HAS
 * inputs but cannot name them passes {@link UNIDENTIFIED_SHARED_INPUTS} instead,
 * and every stored artifact then reads as compiled under other inputs.
 */
export function sharedStyleInputsId(
  inputs: SharedStyleInputs | undefined
): string | undefined {
  if (inputs === undefined) return undefined;
  return `${ENCODING}:${hashId(sharedStyleInputsLabel(inputs))}`;
}
