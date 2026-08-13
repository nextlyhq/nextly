/**
 * The block document format, as a schema something outside TypeScript can check.
 *
 * A builder document is written by an editor, stored in a `blocks` field, and
 * read back by a renderer — but it is also written by hand, by a generator, and
 * by an agent that has the file and no package installed. Those consumers have
 * never had anything to validate against: the format lives in TypeScript
 * interfaces, which a JSON producer cannot check itself against.
 *
 * This states the format as data instead, and publishes it as JSON Schema.
 *
 * ## What this schema is, and is not
 *
 * It describes the document's STRUCTURE — the envelope, the node shape, and the
 * closed vocabularies. It is deliberately not a second implementation of
 * `validate()`: the engine decides whether a document is legal against a live
 * registry, breakpoints and a mode, none of which a static schema can hold.
 *
 * So the two answer different questions, and the split is intentional:
 *
 * - this schema answers "is this the block document format at all"
 * - `validate(doc, ctx)` answers "is this a legal document for THIS app"
 *
 * Where it cannot be exact it stays permissive, because a false rejection
 * refuses a document the engine would have accepted, while a false acceptance
 * is caught moments later by the engine itself with a better message.
 *
 * ## Why it lives here rather than in the engine
 *
 * `@nextlyhq/blocks-engine` carries no schema library on purpose — it has to
 * stay usable from a Node script, an edge runtime, a browser and an external
 * agent without a framework install. Schema publication is core's job, which is
 * also where the block manifest's schema is emitted from, so a reader looking
 * for "the published contracts" finds them in one place.
 *
 * The direction of the dependency is what makes this safe: core reads the
 * engine's types, never the reverse, so the engine remains the single owner of
 * the format and this file can only ever describe it.
 *
 * @module plugins/codegen/block-document
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  BINDING_FORMAT_TYPES,
  BINDING_SOURCES,
  DEFAULT_MAX_DOCUMENT_BYTES,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  MAX_DEPTH,
  MAX_NODES,
  STYLE_STATES,
  isPlainRecord,
  measureBytes,
} from "@nextlyhq/blocks-engine/format";
import type {
  BindingFormatType,
  BindingSource,
  DocumentKind,
  StyleState,
} from "@nextlyhq/blocks-engine/format";
import { z } from "zod";

/**
 * The closed vocabularies, read from the engine rather than written out again.
 *
 * A copy of these lists would compile forever and drift the first time a kind
 * or a state is added, and the drift would be silent in exactly the direction
 * that matters: a published schema still describing yesterday's format. Reading
 * the engine's own constants means the schema cannot describe a vocabulary the
 * engine does not have.
 *
 * The cast is to a non-empty TUPLE of the engine's own literal types, which is
 * the shape `z.enum` asks for. Casting to `[string, ...string[]]` instead would
 * compile and silently widen the inferred key to `string`, so the schema would
 * describe an open vocabulary while the engine's is closed — the published
 * contract quietly promising more than the format allows. The arrays are
 * non-empty by construction; an empty one would be an engine defect this cast
 * cannot cause.
 */
const documentKinds = DOCUMENT_KINDS as unknown as readonly [
  DocumentKind,
  ...DocumentKind[],
];
const styleStates = STYLE_STATES as unknown as readonly [
  StyleState,
  ...StyleState[],
];

/**
 * The binding vocabulary, read from the engine for the same reason as the two
 * above.
 *
 * `bindingSourcesWithoutSingle` is DERIVED by removing the one member the
 * union's other branch owns, rather than written out as its own list. A second
 * literal list would be a copy of a copy: adding a source to the engine would
 * leave this branch rejecting it while every test on both sides still passed,
 * which is precisely the drift reading the engine's constants exists to
 * prevent. The filter states the relationship instead of restating the members.
 */
const bindingFormatTypes = BINDING_FORMAT_TYPES as unknown as readonly [
  BindingFormatType,
  ...BindingFormatType[],
];
const bindingSourcesWithoutSingle = BINDING_SOURCES.filter(
  source => source !== "single"
) as unknown as readonly [BindingSource, ...BindingSource[]];

/**
 * A record whose KEYS are arbitrary strings, checked without rebuilding it.
 *
 * `z.record` is wrong for every field here whose keys come from a document
 * rather than from this codebase, and it is wrong in both directions:
 *
 * - a own key named `constructor` makes it reject the whole record, so a block
 *   with a prop of that name is refused although the engine accepts it;
 * - a own key named `__proto__` — which `JSON.parse` produces as an ordinary
 *   own property — is silently DROPPED from the rebuilt object.
 *
 * Prop names, style property names and HTML attribute names are all arbitrary
 * strings, so both cases describe legitimate stored data.
 *
 * The cause is the rebuild: zod copies the entries into a fresh object, and
 * assigning `__proto__` by key sets a prototype instead of creating a property.
 * So this validates in place and hands back the value it was given. `refine`
 * over `z.unknown()` never constructs anything, which is also the literal form
 * of this module's returns-unchanged guarantee rather than an approximation of
 * it.
 *
 * The predicate is the ENGINE's. A local "object, not null, not an array"
 * check admits a `Date`, a `Map` and a class instance, each of which has no own
 * enumerable keys — so a walk over one finds nothing and reports it clean,
 * while JSON turns it into a string or `{}` on the way to storage. Deciding by
 * prototype is what separates a record from an object that merely is one, and
 * the engine already answers that question for its own validator.
 *
 * `meta` carries the JSON Schema fragment, because `z.unknown()` alone would
 * publish `{}` and describe a field that accepts anything.
 */
function openRecord(valuesFragment: Record<string, unknown> = {}) {
  return z
    .unknown()
    .refine(isPlainRecord, { message: "Expected an object" })
    .meta({ type: "object", additionalProperties: valuesFragment });
}

function typedRecord(
  check: (value: unknown) => boolean,
  valuesFragment: Record<string, unknown>,
  message: string
) {
  return z
    .unknown()
    .refine(
      (value): value is Record<string, unknown> =>
        isPlainRecord(value) && Object.values(value).every(check),
      { message }
    )
    .meta({ type: "object", additionalProperties: valuesFragment });
}

/**
 * One state × breakpoint bucket of style values.
 *
 * Values are unconstrained, and the token reference is described in prose
 * rather than modelled here. Modelling it as `union([tokenRef, unknown])`
 * would carry the token shape into the published schema and pay for it by
 * repairing input: a closed token branch strips what it does not declare, so
 * `{ $token: "brand.primary", extra: true }` would match, come back as a clean
 * token reference, and hide the extra key the engine rejects. Documentation is
 * not worth a checker that silently alters what it accepts.
 *
 * The catalog is additive-open besides, so enumerating today's properties
 * would start refusing documents the moment it grew.
 */
const styleValuesSchema = openRecord();

/**
 * The typed-style envelope: states on one axis, breakpoints on the other.
 *
 * Both axes are objects rather than arrays so a document merges cleanly and a
 * reader can ask for one bucket without scanning. The STATE axis is closed and
 * the breakpoint axis is not, because breakpoint ids are site configuration.
 *
 * `partialRecord`, not `record`: a record keyed by an enum requires EVERY
 * member, so the plain form would refuse a node that styles only its base
 * state — which is nearly every node. The stored type is a `Partial` for the
 * same reason.
 */
const nodeStylesSchema = z.partialRecord(
  z.enum(styleStates),
  typedRecord(
    value => styleValuesSchema.safeParse(value).success,
    { type: "object" },
    "Expected an object of style buckets"
  )
);

/** One entry-field predicate. */
const conditionSchema = z.looseObject({
  field: z.string(),
  op: z.string(),
  value: z.unknown().optional(),
});

/**
 * Visibility, with its two mechanisms kept apart.
 *
 * `conditions` is OR-of-AND (outer array ORs, inner arrays AND) and decides
 * whether a node is SERVED at all; `devices` decides whether a served node is
 * SHOWN at a breakpoint. Conflating them would mean a conditioned node either
 * leaks into the payload or a hidden-on-mobile node stops being indexed.
 */
const nodeVisibilitySchema = z.looseObject({
  conditions: z.array(z.array(conditionSchema)).optional(),
  devices: typedRecord(
    value => typeof value === "boolean",
    { type: "boolean" },
    "Expected an object of booleans"
  ).optional(),
});

/**
 * Locale-aware display formatting for a bound value.
 *
 * Built by mapping the engine's own list rather than by writing five shapes
 * out, so a format added to the engine appears here without an edit and one
 * removed cannot linger. `currency` is the only member carrying a required
 * field of its own, which is why it is the only branch named.
 *
 * `looseObject` throughout, like every other object in this module: see
 * {@link blockNodeSchema} for why passing an unknown key through is the whole
 * point of an additive-open format.
 */
const formatOptionsSchema = openRecord().optional();

const bindingFormatVariants = bindingFormatTypes.map(type =>
  type === "currency"
    ? z.looseObject({
        type: z.literal(type),
        currency: z.string(),
        options: formatOptionsSchema,
      })
    : z.looseObject({ type: z.literal(type), options: formatOptionsSchema })
);

/**
 * The cast supplies the non-empty shape `z.union` requires, which `map` cannot
 * express: an array literal's length is known to the compiler and a mapped
 * array's is not. It widens nothing — the element type is the mapped variants'
 * own — so a variant that stopped matching the format would still fail to
 * compile.
 */
type BindingFormatVariant = (typeof bindingFormatVariants)[number];

const bindingFormatSchema = z.union(
  bindingFormatVariants as unknown as readonly [
    BindingFormatVariant,
    BindingFormatVariant,
    ...BindingFormatVariant[],
  ]
);

/**
 * The published description of a binding, taken from the schema that enforces
 * it rather than written out beside it.
 *
 * `bindings` is checked in place like the other document-keyed records, which
 * means its value schema is no longer part of the emitted tree and would
 * otherwise vanish from the published contract. Deriving the fragment keeps the
 * two the same statement. `$schema` is dropped because this is embedded rather
 * than served as a document of its own.
 */
function bindingFragment(): Record<string, unknown> {
  const { $schema: _ignored, ...fragment } = z.toJSONSchema(bindingSchema, {
    io: "input",
  }) as Record<string, unknown>;
  return fragment;
}

/**
 * A binding: a typed field path, never an expression.
 *
 * `sourceKey` is required for `single` and meaningless for every other source,
 * because a single is addressed by slug while the others are implied by the
 * render context. Stated as a union so a document naming a single without
 * saying which one fails here rather than resolving to nothing at read time.
 */
const bindingSchema = z.union([
  z.looseObject({
    $bind: z.string(),
    fallback: z.unknown().optional(),
    format: bindingFormatSchema.optional(),
    source: z.enum(bindingSourcesWithoutSingle).optional(),
    /**
     * Declared so a misplaced key is REFUSED rather than dropped.
     *
     * An object schema strips what it does not declare, so omitting this would
     * accept `{ source: "entry", sourceKey: "hero" }`, return a document with
     * the key silently removed, and hand the caller a value the engine rejects.
     * The two answers would disagree, and the one that sanitizes is the one
     * that hides the disagreement. `never().optional()` is this schema's
     * spelling of the stored type's `sourceKey?: never`.
     */
    sourceKey: z.never().optional(),
  }),
  z.looseObject({
    $bind: z.string(),
    fallback: z.unknown().optional(),
    format: bindingFormatSchema.optional(),
    source: z.literal("single"),
    sourceKey: z.string(),
  }),
]);

/**
 * One block instance.
 *
 * `slots` recurses, so this schema is self-referential: zod resolves the getter
 * lazily, and the emitted JSON Schema carries a `$ref` back to this definition
 * rather than unrolling to a fixed depth. Depth is a runtime limit the engine
 * enforces against a real document; a schema cannot express "twelve deep"
 * without writing the format out twelve times.
 *
 * `version` is required on every node rather than defaulted, because forgiving
 * rendering and the manifest's version stamp both read it unconditionally — a
 * node without one cannot be migrated, only guessed at.
 */
const blockNodeSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  version: z.number().int().positive(),
  props: openRecord(),
  bindings: typedRecord(
    value => bindingSchema.safeParse(value).success,
    bindingFragment(),
    "Expected an object of bindings"
  ).optional(),
  get slots() {
    // The one document-keyed record NOT checked in place, and the exception is
    // the published schema rather than an oversight. Checking slots with a
    // predicate takes the node schema out of the emitted tree, and with it the
    // `$ref` that describes nesting at all: the contract stops saying a slot
    // holds nodes and says only that it holds an array, so an external consumer
    // can no longer validate anything below the first level. Describing the
    // recursion is most of what publishing this format is for.
    //
    // What that costs is bounded, and smaller than the alternative. Slot names
    // are declared by block definitions rather than typed by authors, so a slot
    // literally named `constructor` is refused; and the parsed copy of a slot
    // named `__proto__` is dropped, so its children go structurally unchecked.
    // Neither loses data, because the value returned is the caller's own.
    return z.record(z.string(), z.array(blockNodeSchema)).optional();
  },
  styles: nodeStylesSchema.optional(),
  classes: z.array(z.string()).optional(),
  visibility: nodeVisibilitySchema.optional(),
  locked: z.boolean().optional(),
  name: z.string().optional(),
  customCss: z.string().optional(),
  cssId: z.string().optional(),
  attributes: typedRecord(
    value => typeof value === "string",
    { type: "string" },
    "Expected an object of strings"
  ).optional(),
  migrationFailed: z.boolean().optional(),
});

/**
 * The stored value of a `blocks` field, and the body of every builder document.
 *
 * The top level is a plain array: a page IS a list of sections. There is no
 * synthetic root node, so no algorithm has to special-case an undeletable,
 * unmovable pseudo-node — document-level concerns live on this envelope
 * instead.
 *
 * `formatVersion` is pinned to the one version this schema describes rather
 * than to any number. The field exists so a reader can tell whether it
 * understands the file at all, and a schema that accepted a version it was not
 * written for would answer that question wrongly.
 */
const blockDocumentSchema = z.looseObject({
  formatVersion: z.literal(DOCUMENT_FORMAT_VERSION),
  kind: z.enum(documentKinds),
  nodes: z.array(blockNodeSchema),
  settings: z
    .looseObject({
      styles: nodeStylesSchema.optional(),
      customCss: z.string().optional(),
    })
    .optional(),
  /**
   * A usage index for media the document references, so reference tracking
   * never needs a full tree walk. Derived on write; a reader that finds it
   * absent walks the tree rather than concluding there is no media.
   */
  assets: z
    .looseObject({ mediaIds: z.array(z.string()).optional() })
    .optional(),
});

/**
 * The shape the schema accepts, as a type.
 *
 * The schema VALUE stays private because parsing without the depth bound is
 * the hazard; a type carries no such risk and lets a contract test assert that
 * the published description and the engine's declaration have not drifted.
 */
export type BlockDocumentShape = z.infer<typeof blockDocumentSchema>;

/**
 * The document format as plain JSON Schema, for a consumer that has neither
 * TypeScript nor zod.
 *
 * Derived from the schema above rather than written beside it, so what is
 * published cannot describe a different format from what this package checks.
 *
 * `io: "input"` emits the shape a producer must WRITE. It matters here because
 * the two differ wherever a schema has defaults, and every consumer of this
 * artifact is writing a document rather than reading one back out of zod.
 */
export function blockDocumentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(blockDocumentSchema, { io: "input" });
}

/**
 * The result of checking a value against the format.
 *
 * Mirrors zod's `safeParse` shape rather than throwing, because every caller
 * this entry point exists for is holding input it did not produce, and an
 * exception is the wrong control flow for expected badness.
 */
export type BlockDocumentParseResult =
  | { success: true; data: BlockDocument }
  | { success: false; issues: string[] };

/**
 * Whether a value exceeds the format's structural limits, measured WITHOUT
 * recursion and BEFORE the schema sees it.
 *
 * Two limits, one traversal. Depth and node count are different questions, but
 * they are answered by walking the same slot tree, and walking it twice would
 * double the cost of the check that exists to bound cost.
 *
 * **Depth.** The schema is self-referential, so parsing a deeply nested value
 * walks it with the call stack: a long enough slot chain raises `RangeError:
 * Maximum call stack size exceeded` before any validation runs. An explicit
 * stack makes depth a value to compare instead of a limit the runtime
 * discovers.
 *
 * **Width.** A document can be shallow and still enormous. `safeParse` walks
 * and CLONES the whole forest before returning success, so a flat array of a
 * million nodes is bounded by nothing the depth check looks at: it passes, and
 * the work happens anyway. Counting first turns that into a rejection.
 *
 * The walk stops at the first breach rather than measuring the true total,
 * which is the point — a bound that reads the whole input to discover the input
 * is too large has already done the work it was protecting against.
 *
 * Both bounds come from the engine so there is one answer to "how deep" and
 * "how many" rather than two that agree until one is edited.
 */
type LimitBreach = "depth" | "nodes";

function exceedsLimits(
  value: unknown,
  maxDepth: number,
  maxNodes: number
): LimitBreach | null {
  if (typeof value !== "object" || value === null) return null;

  // Seeded from the envelope's `nodes`, because that is where a document's
  // tree starts. Seeding from the document itself walks nothing: the envelope
  // has no `slots`, so the first iteration finds none and the pass reports a
  // depth of zero for a document of any shape.
  const roots = (value as { nodes?: unknown }).nodes;
  if (!Array.isArray(roots)) return null;

  // The roots are themselves nodes, so the count starts before the walk does.
  // Checking only what the walk POPS would let a single flat array of a million
  // roots through: nothing in it has slots, so the loop pushes nothing and the
  // count never reaches the cap it was meant to enforce.
  if (roots.length > maxNodes) return "nodes";

  const stack: Array<{ node: unknown; depth: number }> = roots.map(node => ({
    node,
    depth: 1,
  }));
  let counted = roots.length;

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > maxDepth) return "depth";
    if (typeof node !== "object" || node === null) continue;

    const slots = (node as { slots?: unknown }).slots;
    if (typeof slots !== "object" || slots === null) continue;

    for (const children of Object.values(slots as Record<string, unknown>)) {
      if (!Array.isArray(children)) continue;
      // Counted on discovery rather than on pop, so the cap is reached while
      // pushing rather than after a whole generation is already resident.
      counted += children.length;
      if (counted > maxNodes) return "nodes";
      for (const child of children) {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return null;
}

/**
 * Whether a value serializes to more bytes than the format allows, measured
 * without building the string.
 *
 * The third bound, and the one the other two cannot express. Depth and node
 * count both measure the TREE, and a document can be shallow, hold a single
 * node, and still be enormous: one node whose `props` carry a few hundred
 * thousand keys passes both walks and is then cloned in full by the parser.
 * Size is the property that bounds that, and it is the same cap the engine's
 * own `validate()` applies, so the two agree on what is too large.
 *
 * Measured LAST of the three because it is the only one that must read
 * everything. The tree walks stop at their first breach, so a hostile document
 * that is deep or wide never reaches this line.
 *
 * The measurement is the engine's, and it counts rather than serializes: a
 * document hiding one enormous string would otherwise force an allocation
 * proportional to the whole hostile input before anything could reject it,
 * which is the cost this bound exists to avoid paying. It also terminates on a
 * cycle, where building the string would throw.
 *
 * Sharing it with the canonical validator is not tidiness. Two measurements of
 * "how large is this document" disagree about which documents are refused, and
 * they disagree only on the inputs near the cap — the ones that matter.
 */
function exceedsBytes(value: unknown, maxBytes: number): boolean {
  return measureBytes(value, maxBytes).exceeded;
}

/**
 * Check a value against the block document format.
 *
 * This is the entry point to use on a document you did not write. It applies
 * the structural bounds first, so a hostile or merely broken input is REPORTED
 * as invalid rather than exhausting the stack or being cloned in full, and only
 * then runs the schema.
 *
 * The raw schema is deliberately not exported. Depth is a precondition of
 * parsing safely, and an exported schema alongside a guarded function is an
 * invitation to use the unguarded one — a rule with nothing enforcing it. A
 * caller that needs the format as data has `blockDocumentJsonSchema()`, which
 * carries no such hazard.
 *
 * Structural validity only. A legal document for a PARTICULAR app — registered
 * block types, configured breakpoints — is what the engine's `validate()`
 * answers, and this makes no claim about it.
 */
export function parseBlockDocument(value: unknown): BlockDocumentParseResult {
  const breach = exceedsLimits(value, MAX_DEPTH, MAX_NODES);
  if (breach === "depth") {
    return {
      success: false,
      issues: [`Document nests deeper than the format allows (${MAX_DEPTH}).`],
    };
  }
  if (breach === "nodes") {
    return {
      success: false,
      issues: [
        `Document holds more nodes than the format allows (${MAX_NODES}).`,
      ],
    };
  }
  if (exceedsBytes(value, DEFAULT_MAX_DOCUMENT_BYTES)) {
    return {
      success: false,
      issues: [
        `Document serializes to more than the format allows (${DEFAULT_MAX_DOCUMENT_BYTES} bytes).`,
      ],
    };
  }

  const result = blockDocumentSchema.safeParse(value);
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues.map(
        issue => `${issue.path.join("/") || "<root>"}: ${issue.message}`
      ),
    };
  }

  // The CALLER's value, not the parser's output. Every object schema here is
  // open and every document-keyed record is checked in place, so the two are
  // already equal in content — returning the input makes that a property of the
  // function rather than of each schema staying open, and no future field can
  // reintroduce a silent rewrite. It is also the only form under which the
  // returns-unchanged guarantee is literally true: a rebuild cannot represent an
  // own key named `__proto__`, whatever it is assembled from.
  return { success: true, data: value as BlockDocument };
}
