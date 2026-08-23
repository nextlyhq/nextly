/**
 * The identity of the SHARED style inputs a page was compiled against.
 *
 * A stored page stylesheet is a cache of a compile, and a cache is sound only
 * when it is keyed on every input that compile used. `fetchPolicyId` keys one of
 * them. Three more are site-level, shared by every page, and can move underneath
 * a stored artifact with nothing noticing:
 *
 * - **breakpoints**, whose ids and bounds decide the at-rules every tier is
 *   emitted under;
 * - **the token prefix**, which renders into every `var(--<prefix><name>)` the
 *   sheet references;
 * - **the named-class library**, whose slugs become the selectors themselves and
 *   whose styles ARE the rules a page carries for them.
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
import { hashId } from "@nextlyhq/blocks-engine";
import type {
  BreakpointSet,
  NamedClass,
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
  "breakpoints" | "namedClasses" | "tokenPrefix"
>;

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
 * Order is preserved rather than sorted. Breakpoints are emitted in array order
 * and at one specificity the cascade IS source order, so two sets holding the
 * same breakpoints in a different order are genuinely different inputs.
 */
function breakpointParts(set: BreakpointSet): unknown {
  const axis = (defs: BreakpointSet["viewport"]) =>
    defs.map(def => [def.id, def.maxWidth ?? null]);
  return [axis(set.viewport ?? []), axis(set.container ?? [])];
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
function classParts(entry: NamedClass): unknown {
  return [entry.id, entry.slug, entry.orderIndex, entry.styles ?? null];
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
  return JSON.stringify([
    ENCODING,
    breakpointParts(inputs.breakpoints),
    inputs.tokenPrefix ?? null,
    (inputs.namedClasses ?? []).map(classParts),
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
