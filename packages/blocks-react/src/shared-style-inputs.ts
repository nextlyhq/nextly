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
  MAX_SCANNED_KEYS,
  breakpointContexts,
  hashId,
  isPlainRecord,
  orderedNamedClasses,
  safeTokenPrefix,
} from "@nextlyhq/blocks-engine";
import type { StyleCompileContext } from "@nextlyhq/blocks-engine";

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

/**
 * A value the stamp may read fields from without dereferencing a non-object.
 *
 * Deliberately wider than the engine's `isPlainRecord`, used below, which
 * answers a different question. This one asks whether a stored entry has fields
 * to read at all — the same latitude `orderedNamedClassPositions` takes when it
 * reads `orderIndex` off whatever the library happens to hold. That one asks
 * whether a value is a STRUCTURE the compiler descends into, and a class
 * instance has fields while being nothing the compiler reads.
 */
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
 * How deep a stored value is read before the reading stops.
 *
 * Generous by design and still finite. The compiler reads a style envelope four
 * levels down — state, breakpoint, declaration, then the declaration's own value
 * — so nothing it can emit lives anywhere near this, and two values differing
 * only below it compile identically. What the bound buys is that a settings
 * record nesting itself thousands deep costs a truncated reading rather than a
 * stack overflow, which would take down every page on the site.
 */
const MAX_ENVELOPE_DEPTH = 32;

/**
 * A total, structural reading of one stored value.
 *
 * `JSON.stringify` is what this replaces, and it was the wrong instrument in
 * both directions. It THROWS on a value the compiler reads perfectly well: a
 * cycle under an unrecognised state is skipped by `compilePageCss` — which
 * iterates the states it knows and never descends into one it does not — so the
 * page compiles while a stamp taken with `JSON.stringify` fails the render
 * outright. And catching that throw is no answer either: one constant for every
 * unreadable envelope makes two libraries that emit DIFFERENT css stamp alike,
 * which reuses a stale sheet forever — a silent wrong page, where the throw was
 * at least loud.
 *
 * So the reading is total instead. A cycle is recorded as a cycle and the walk
 * continues, which keeps every difference outside it: two envelopes differing
 * only in a colour beside a self-referential value still stamp apart, and the
 * colour is exactly what the compiler emits from them.
 *
 * `ancestors` holds the path currently being walked, not everything seen, and
 * entries are removed on the way back out. A set of everything seen would mark
 * the second reference to one shared object as a cycle, and a library that
 * reuses one style object across two classes is ordinary rather than corrupt.
 *
 * Own enumerable keys, sorted — the same reading `boundedKeys` performs in the
 * compiler, so a record's key order in storage moves neither the CSS nor this.
 *
 * The split across four functions follows what the reading has to DO rather than
 * being a tidying. This one decides which KIND a value is, and only a structure
 * can recur, close a cycle or reach the depth bound; {@link leafText} writes the
 * values that cannot; {@link sequenceText} and {@link recordText} each read one
 * kind of structure, and each carries the width bound for its own shape.
 */
function structuralText(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  reading: Reading
): string {
  if (typeof value !== "object" || value === null) return leafText(value);
  if (ancestors.has(value)) return "<cycle>";
  if (depth >= MAX_ENVELOPE_DEPTH) return "<deeper>";
  ancestors.add(value);
  try {
    if (Array.isArray(value))
      return sequenceText(value, ancestors, depth, reading);
    // Only a PLAIN record is a structure. The compiler descends with
    // `isPlainRecord` and treats anything else — a Map, a Date, a class
    // instance — as a value it cannot write, reporting it and emitting nothing.
    // Two of them therefore produce identical css, and reading their fields here
    // would invalidate artifacts over a difference no stylesheet can show.
    if (!isPlainRecord(value)) return "<opaque>";
    return recordText(value, ancestors, depth, reading);
  } finally {
    ancestors.delete(value);
  }
}

/** A sequence, read in stored order, which is the only order it has. */
function sequenceText(
  items: readonly unknown[],
  ancestors: Set<object>,
  depth: number,
  reading: Reading
): string {
  // Bounded exactly as a record is, and for the same reason: an array is a
  // stored value like any other and nothing validated its length.
  if (items.length > MAX_SCANNED_KEYS) return overWide(reading);
  const parts: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    parts.push(memberText(() => items[index], ancestors, depth, reading));
  }
  return `[${parts.join(",")}]`;
}

/** A record, read by its own enumerable keys in sorted order. */
function recordText(
  record: Record<string, unknown>,
  ancestors: Set<object>,
  depth: number,
  reading: Reading
): string {
  // Counted before anything materialises the key list, because `Object.keys` on
  // a record with a million entries has already paid the cost this bound exists
  // to refuse.
  if (ownKeyCount(record, MAX_SCANNED_KEYS + 1) > MAX_SCANNED_KEYS)
    return overWide(reading);
  return `{${Object.keys(record)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${memberText(() => record[key], ancestors, depth, reading)}`
    )
    .join(",")}}`;
}

/**
 * One value the walk does not descend into, written so no two kinds collide.
 *
 * Markers are unquoted while every string is quoted, which is what keeps them
 * disjoint: a stored value of `"<cycle>"` reads as `"<cycle>"` and a real cycle
 * reads as `<cycle>`, so neither can be mistaken for the other.
 */
function leafText(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
    case "boolean":
      // `String`, not `JSON.stringify`, which writes `null` for NaN and for both
      // infinities and would therefore stamp three distinct stored numbers, and
      // a stored `null`, identically.
      return String(value);
    case "bigint":
      // Suffixed, so `1n` and `1` stay apart. `JSON.stringify` throws on this
      // one rather than losing it, which is the failure this walk exists to end.
      return `${String(value)}n`;
    case "undefined":
      // Kept apart from `null`, because the compiler keeps them apart: a
      // breakpoint whose value is `undefined` is a node saying nothing about it,
      // while a stored `null` is a malformed value it reports.
      return "undefined";
    default:
      // A symbol or a function. Neither survives storage nor reaches CSS, so
      // they need to be distinguishable from a value that does, and no more.
      return `<${typeof value}>`;
  }
}

/**
 * Whether one whole reading met a record too wide to be read.
 *
 * Carried rather than returned, because the answer is not about the value being
 * read — it is about whether the INPUTS as a whole can still be identified, and
 * that is decided by the outermost caller.
 */
interface Reading {
  overWide: boolean;
}

/**
 * How many own keys a record has, counted no further than it needs to be.
 *
 * The same bounded enumeration `boundedKeys` performs in the compiler, without
 * building the array: the only question here is whether the record is wider
 * than the compiler will read, and the answer is known at key 257.
 */
function ownKeyCount(record: Record<string, unknown>, stopAt: number): number {
  let count = 0;
  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue;
    count += 1;
    if (count >= stopAt) break;
  }
  return count;
}

/**
 * A record wider than the compiler reads, which makes the whole reading refuse.
 *
 * TRUNCATING here would be unsound in the silent direction: the compiler reaches
 * a state or a breakpoint by NAME, so a key sorted past any cut is still emitted,
 * and two libraries differing only there would stamp alike. Refusing to identify
 * the inputs at all costs a recompile per render on a settings row this wide,
 * which nothing legitimate produces — an envelope holds four states, a state map
 * holds one entry per breakpoint, and a declaration record holds one per CSS
 * property this engine knows.
 */
function overWide(reading: Reading): string {
  reading.overWide = true;
  return "<over-wide>";
}

/**
 * One member of a structure, read behind a guard.
 *
 * A property whose getter throws is one the compiler cannot read either. The
 * failure is confined to that member rather than failing the whole envelope, so
 * everything beside it still reaches the stamp.
 */
function memberText(
  read: () => unknown,
  ancestors: Set<object>,
  depth: number,
  reading: Reading
): string {
  try {
    return structuralText(read(), ancestors, depth + 1, reading);
  } catch {
    return "<unreadable>";
  }
}

/** The same reading, started fresh. */
function structural(value: unknown, reading: Reading): string {
  return structuralText(value, new Set<object>(), 0, reading);
}

/**
 * One class's styles, reduced to a digest of their whole structural reading.
 *
 * DIGESTED rather than carried, because the label holds one entry per class and
 * a library runs to `MAX_NAMED_CLASSES`: carrying the envelopes would build a
 * string the size of the site's whole class configuration on every render, and
 * then hash that.
 *
 * Digested rather than TRUNCATED, which is what this did first and was strictly
 * worse. Truncating the serialized text bounds the label but not the work — the
 * whole string is materialised before anything can slice it — so it paid the
 * allocation anyway and gave up sensitivity for it: two envelopes differing only
 * past the cut, at the same length, stamped alike while the compiler emitted
 * different CSS. Hashing bounds the label the same way and every character
 * reaches the digest.
 */
function styleEnvelope(styles: unknown, reading: Reading): string {
  return hashId(structural(styles, reading));
}

/**
 * One class, reduced to what reaches the stylesheet — which is all of it.
 *
 * Every field decides output: `slug` becomes the selector, `orderIndex` decides
 * which class wins where two apply, `styles` are the declarations themselves,
 * and `id` is what a document references and what the emitted class map keys.
 * This is why the serialization is large and therefore why `styles` is digested.
 *
 * The other three are carried whole rather than digested, so the label stays
 * legible enough to answer WHICH class moved — which is the question it exists
 * to answer — and they are safe to carry raw because the reading above is total.
 */
function classParts(entry: unknown, reading: Reading): unknown {
  // A malformed entry is reduced rather than dereferenced. This library is one
  // site-settings record read on every page render, and it arrives whether or
  // not anything validated it — `compilePageCss` treats a corrupt entry as
  // untrusted and skips it with a warning rather than failing the render, and a
  // stamp that threw on the same row would take down every page on the site
  // instead of costing one class its styling.
  //
  // Reduced to its own reading rather than to a hole, so a corrupt entry still
  // occupies its position AND stays distinguishable from a differently corrupt
  // one: dropping it would let a library gain a bad row and stamp identically.
  if (!isRecord(entry)) return structural(entry, reading);
  return [
    structural(entry.id, reading),
    structural(entry.slug, reading),
    structural(entry.orderIndex, reading),
    styleEnvelope(entry.styles, reading),
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
 * built in a different order. An absent field and an empty one stay apart, which
 * matters for `tokenPrefix`: unset means the engine's own default, and `""`
 * means a site that deliberately declared no prefix, and those compile to
 * different custom-property names.
 *
 * Every member that came from storage is reduced by the walk above BEFORE this
 * composes them, which is what makes the composition safe to do with
 * `JSON.stringify` — and therefore what keeps the label parseable. Reducing
 * first rather than composing first is the whole difference: a class whose `id`
 * is a circular value is one `compilePageCss` skips with a warning, and a label
 * that handed that value to `JSON.stringify` would throw and take the page down
 * before the forgiving compiler ever ran.
 */
export function sharedStyleInputsLabel(inputs: SharedStyleInputs): string {
  return labelFor(inputs, { overWide: false });
}

function labelFor(inputs: SharedStyleInputs, reading: Reading): string {
  // Bounded exactly as the compiler bounds it. `compilePageCss` reads only the
  // first `MAX_NAMED_CLASSES` entries, so entries past that cap reach no
  // stylesheet and must not move a stamp — and an oversized settings row must
  // not restore, here, the unbounded allocation the compiler's cap exists to
  // prevent.
  const library = Array.isArray(inputs.namedClasses) ? inputs.namedClasses : [];
  return JSON.stringify([
    ENCODING,
    // The ENGINE'S normalised answer, not the stored axes. `breakpointContexts`
    // drops a definition whose bound is missing or unusable, keeps the first of
    // a duplicated id, sorts each axis and caps it, and gives every survivor the
    // at-rule text itself — so what this reads is the set of queries the sheet
    // is actually emitted under. Stamping the raw axes instead invalidates every
    // artifact on the site when someone adds a breakpoint the compiler discards,
    // for CSS that does not change by a byte, and lets a corrupt oversized axis
    // restore the unbounded per-render scan the compiler's cap exists to
    // prevent. Read rather than restated, for the reason the class ordering is:
    // a second copy of those rules drifts from the one that decides the output.
    breakpointContexts(inputs.breakpoints),
    // The prefix tokens are actually WRITTEN under, not the one that was stored.
    // `safeTokenPrefix` maps unset, malformed and reserved prefixes alike to the
    // engine's default, so all of them emit identical `var(--site-*)` references
    // — and stamping the raw setting recompiles every page on the site when one
    // rejected spelling is replaced by another. A non-string is passed as absent
    // because it resolves to that same default.
    safeTokenPrefix(
      typeof inputs.tokenPrefix === "string" ? inputs.tokenPrefix : undefined
    ).prefix,
    // Ordered by the ENGINE'S own comparator rather than as stored, because the
    // compiler sorts the library before emitting it — so two storage orders of
    // the same classes produce identical CSS and must produce identical stamps.
    // Imported rather than restated: a comparator copied here would drift from
    // the one that decides the output, and the drift would be silent in both
    // directions.
    orderedNamedClasses(library.slice(0, MAX_NAMED_CLASSES)).map(entry =>
      classParts(entry, reading)
    ),
    // The block-type defaults, which the renderer resolves beside the other
    // three and the compiler emits into this very sheet. Keyed by type, so the
    // reading of the record is stable only if the keys are — hence the sort,
    // which is the one place order is imposed rather than preserved: a record
    // has no meaningful order and two equal sets must not stamp apart.
    //
    // Each base goes through the SAME reduction a class envelope does. They are
    // style envelopes of the same shape, arriving from the same untrusted place
    // — a block package's declaration or a stored site record — and carrying one
    // of them raw would put a value the reduction exists to survive back into
    // the label.
    blockBaseParts(inputs.blockBases, reading),
  ]);
}

/** Each block type's defaults, in a fixed key order, reduced as classes are. */
function blockBaseParts(
  blockBases: SharedStyleInputs["blockBases"],
  reading: Reading
): unknown[] {
  const bases = blockBases ?? {};
  return Object.keys(bases)
    .sort()
    .map(type => [
      structural(type, reading),
      styleEnvelope(bases[type], reading),
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
  const reading: Reading = { overWide: false };
  const label = labelFor(inputs, reading);
  // A settings row too wide to read is not identified rather than partially
  // identified, which is the sentinel's existing meaning: the caller HAS shared
  // inputs and cannot name them, so every stored artifact reads as compiled
  // against others and is recompiled. Partial identification would be the silent
  // failure instead — two libraries differing only in what went unread would
  // stamp alike.
  return reading.overWide
    ? UNIDENTIFIED_SHARED_INPUTS
    : `${ENCODING}:${hashId(label)}`;
}
