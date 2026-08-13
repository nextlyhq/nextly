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
  surveyDocument,
} from "@nextlyhq/blocks-engine/format";
import type {
  BindingSource,
  DocumentKind,
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
const bindingFormatTypes = BINDING_FORMAT_TYPES;
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
 * A record whose KEYS are a closed vocabulary, checked without rebuilding it.
 *
 * `z.partialRecord` keyed by an enum has the same rebuild problem as the open
 * records above, with the opposite consequence. An own `__proto__` key is not a
 * valid style state, so it should be REFUSED; instead it is silently omitted
 * from the parsed copy, the parse succeeds, and the caller gets back its own
 * object with the invalid key still on it. Dropping a key the format forbids is
 * worse than dropping one it merely does not know about: the document is
 * reported valid while carrying something the engine rejects.
 *
 * So the keys are checked in place against the closed set. `propertyNames`
 * carries the vocabulary into the published schema, which is what a consumer
 * reads to learn the axis is closed.
 */
function closedKeyRecord(
  allowed: readonly string[],
  valueCheck: (value: unknown) => boolean,
  valuesFragment: Record<string, unknown>
) {
  const permitted = new Set(allowed);
  return z
    .unknown()
    .refine(
      (value): value is Record<string, unknown> =>
        isPlainRecord(value) &&
        Object.keys(value).every(key => permitted.has(key)) &&
        Object.values(value).every(valueCheck),
      { message: `Expected an object keyed by: ${allowed.join(", ")}` }
    )
    .meta({
      type: "object",
      propertyNames: { type: "string", enum: [...allowed] },
      additionalProperties: valuesFragment,
    });
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
const styleBucketsSchema = typedRecord(
  value => styleValuesSchema.safeParse(value).success,
  { type: "object" },
  "Expected an object of style buckets"
);

const nodeStylesSchema = closedKeyRecord(
  STYLE_STATES,
  value => styleBucketsSchema.safeParse(value).success,
  // Describes BOTH remaining levels, not just the state. Stopping at
  // `{ type: "object" }` left an external validator accepting
  // `styles: { base: { mobile: 1 } }` — a breakpoint whose bucket is a number
  // rather than a map of style values — which this module's own parse refuses.
  // A published schema looser than the checker beside it sends a producer
  // output that fails on arrival.
  { type: "object", additionalProperties: { type: "object" } }
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
const blockNodeSchema = z
  .looseObject({
    id: z.string(),
    type: z.string(),
    // A positive SAFE integer, and the ceiling is deliberate rather than an
    // artefact of the validator. A version above 2^53-1 does not survive JSON:
    // the text `{"version":9007199254740993}` parses to `...992` and serializes
    // back as `...992`, so the number read is not the number written. Accepting
    // it would admit exactly the silent-rewrite class this entry point refuses
    // for `-0`, `NaN` and the infinities. The published `maximum` states the
    // bound rather than leaving a consumer to discover it.
    // A positive integer, with no safe-integer ceiling, because the canonical
    // `validate()` has none. Two validators disagreeing about which documents
    // are legal is worse than either rule, and a schema stricter than the
    // engine refuses documents the engine accepts.
    //
    // The earlier ceiling was argued from round-tripping and the argument was
    // too broad: an ODD integer above 2^53 does not survive JSON, but 1e20 is
    // exactly representable and round-trips unchanged, so the bound refused
    // values that were never at risk. The remaining case belongs wherever the
    // engine decides it, for both validators at once.
    version: z
      .number()
      .refine(value => Number.isInteger(value) && value > 0, {
        message: "Expected a positive integer",
      })
      // The fragment is carried explicitly because a refinement is invisible to
      // the emitted schema: dropping the ceiling took `"type": "integer"` and
      // the positivity bound with it, leaving a published contract that
      // accepted any number while this module still refused one. A schema
      // looser than the checker beside it sends a producer output that fails on
      // arrival.
      .meta({ type: "integer", exclusiveMinimum: 0 }),
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
  })
  .refine(ownsRequiredFields, {
    message:
      "A node must OWN its id, type, version and props; an inherited value is not written to storage.",
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
/**
 * The fields a node must own, rather than merely reach.
 *
 * The schema reads properties directly, so a value inherited from
 * `Object.prototype` satisfies it — while `JSON.stringify` writes only own
 * properties and the survey enumerates only own names. In an environment where
 * something has put `id`, `type`, `version` and `props` on the prototype, an
 * empty object therefore parsed as a valid node and then persisted as `{}`.
 *
 * Checked here rather than in the survey because the survey has no notion of
 * which fields a node REQUIRES; this is the layer that knows.
 */
const NODE_OWN_FIELDS = ["id", "type", "version", "props"] as const;

/**
 * The envelope's required fields, which need the same treatment as a node's.
 *
 * `parseBlockDocument({})` succeeded where `Object.prototype` carried a valid
 * `formatVersion`, `kind` and `nodes`, for exactly the reason a node did: the
 * schema reads properties directly while storage writes only own ones.
 */
const DOCUMENT_OWN_FIELDS = ["formatVersion", "kind", "nodes"] as const;

function ownsFields(value: unknown, fields: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  return fields.every(field =>
    Object.prototype.hasOwnProperty.call(value, field)
  );
}

function ownsRequiredFields(value: unknown): boolean {
  return ownsFields(value, NODE_OWN_FIELDS);
}

const blockDocumentSchema = z
  .looseObject({
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
  })
  .refine(value => ownsFields(value, DOCUMENT_OWN_FIELDS), {
    message:
      "A document must OWN its formatVersion, kind and nodes; an inherited value is not written to storage.",
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
 * One traversal answers every precondition, and that is the point.
 *
 * Depth, node count, serialized size, JSON-representability and safe reading
 * are five questions about the same tree, and asking them separately is how
 * they diverge: each walk grows its own defensive logic, a property added to
 * one is missing from the other, and the gap is invisible because both look
 * correct. `surveyDocument` visits each value once and answers all five.
 *
 * Run BEFORE the schema, because each bound is a precondition rather than a
 * verdict: parsing a document that is too deep exhausts the stack, and parsing
 * one that is too large copies it in full — both before anything could report
 * that it was invalid.
 */
export function parseBlockDocument(value: unknown): BlockDocumentParseResult {
  const survey = surveyDocument(value, {
    maxBytes: DEFAULT_MAX_DOCUMENT_BYTES,
    maxDepth: MAX_DEPTH,
    maxNodes: MAX_NODES,
  });

  if (survey.tooDeep) {
    return {
      success: false,
      issues: [`Document nests deeper than the format allows (${MAX_DEPTH}).`],
    };
  }
  if (survey.tooManyNodes) {
    return {
      success: false,
      issues: [
        `Document holds more nodes than the format allows (${MAX_NODES}).`,
      ],
    };
  }
  if (survey.tooLarge) {
    return {
      success: false,
      issues: [
        `Document serializes to more than the format allows (${DEFAULT_MAX_DOCUMENT_BYTES} bytes).`,
      ],
    };
  }
  if (survey.unserializable) {
    return {
      success: false,
      issues: [
        "Document holds a value JSON cannot represent unchanged (a BigInt, a function, a symbol, `undefined`, a non-finite number, `-0`, an object that is not a plain record, an unreadable accessor, or a repeated reference).",
      ],
    };
  }

  // The schema reads the caller's value a SECOND time, by ordinary property
  // access rather than through the survey's guarded descriptor path. For an
  // ordinary document the two agree; for a proxy they need not, and a `get`
  // trap that throws would propagate out of a function whose whole contract is
  // to report rather than raise. A throw here is therefore a verdict about the
  // input, not an error in the checker.
  //
  // What this cannot promise: a STATEFUL proxy may answer differently again
  // after this returns. The value belongs to the caller and nothing here can
  // freeze it, so the guarantee is about what was checked, not about what the
  // caller does with its own object afterwards.
  let result: ReturnType<typeof blockDocumentSchema.safeParse>;
  try {
    result = blockDocumentSchema.safeParse(value);
  } catch {
    return {
      success: false,
      issues: ["Document could not be read consistently while being checked."],
    };
  }
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
