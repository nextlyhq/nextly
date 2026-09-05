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
  BINDING_FORMAT_SHAPES,
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
  BindingFormatType,
  BindingSource,
  DocumentKind,
} from "@nextlyhq/blocks-engine/format";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";

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
/**
 * Where a copied subtree came from.
 *
 * A union rather than one loose object, because the two arms genuinely differ:
 * a pattern copy carries a digest of what it copied and a detached component
 * does not. One object with an optional digest would accept a pattern origin
 * that cannot answer the question it exists for.
 */
const blockOriginSchema = z.union([
  z.looseObject({
    from: z.literal("pattern"),
    id: z.string(),
    digest: z.string(),
  }),
  z.looseObject({
    from: z.literal("component"),
    id: z.string(),
  }),
]);

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
 * removed cannot linger.
 *
 * `looseObject` throughout, like every other object in this module: see
 * {@link blockNodeSchema} for why passing an unknown key through is the whole
 * point of an additive-open format.
 */
const formatOptionsSchema = openRecord().optional();

/**
 * The engine's shape map, narrowed to what this file can build a schema from.
 *
 * The annotation is the check: `BINDING_FORMAT_SHAPES` is assigned INTO it, so
 * a variant that grows a field the mapping below cannot express stops
 * compiling here rather than being silently skipped. That keeps
 * {@link formatFieldSchema} total over everything the map can hold, with no
 * runtime branch for a case that cannot occur and no throw at import time.
 */
const bindingFormatShapes: Readonly<
  Record<
    BindingFormatType,
    Readonly<Record<string, string | number | boolean>> | null
  >
> = BINDING_FORMAT_SHAPES;

/**
 * A required field's schema, from the sample value the engine's map holds.
 *
 * The map states each field's type by example, because that is what lets the
 * engine derive its own `BindingFormat` type from the same declaration. Reading
 * the example back is how one declaration serves both.
 */
function formatFieldSchema(sample: string | number | boolean) {
  if (typeof sample === "number") return z.number();
  if (typeof sample === "boolean") return z.boolean();
  return z.string();
}

/**
 * Each variant carries the required fields its entry declares.
 *
 * Naming one variant here — `currency` was the only member with a field of its
 * own — meant a format that later gained a required field would be published as
 * fieldless, so a producer could satisfy this schema and still be refused by the
 * engine. Reading the fields from the same map the engine's type is built from
 * removes the second declaration rather than keeping two in step.
 */
const bindingFormatVariants = bindingFormatTypes.map(type => {
  const shape = bindingFormatShapes[type];
  const required = Object.fromEntries(
    Object.entries(shape ?? {}).map(([field, sample]) => [
      field,
      formatFieldSchema(sample),
    ])
  );
  return z.looseObject({
    type: z.literal(type),
    ...required,
    options: formatOptionsSchema,
  });
});

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
const blockNodeObject = z.looseObject({
  id: z.string(),
  type: z.string(),
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
  origin: blockOriginSchema.optional(),
});

const blockNodeSchema = blockNodeObject;

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
 * A declared field name that `Object.prototype` supplies, if there is one.
 *
 * The defect this answers: the schema reads properties by ordinary access, so a
 * value reached through the prototype satisfies it, while `JSON.stringify`
 * writes only own properties and the survey enumerates only own names. An empty
 * object then parses as a valid node and persists as `{}` — and an inherited
 * OPTIONAL field is worse, because nothing required it and the parsed value
 * reads it back from a document storage never received.
 *
 * ONE check for the whole document rather than one per object, and the
 * equivalence is what makes that sound. Every object the survey admits is a
 * plain record, whose prototype is `Object.prototype` or null; a null-prototype
 * object inherits nothing at all. So `Object.prototype` is the only place a
 * document object can reach a field it does not own, and asking it once answers
 * for every object at once.
 *
 * Deliberately NOT the intuitive form, which is to check ownership on each
 * value as it is validated. A `refine` receives the schema's OUTPUT, and zod
 * builds that output by copying each declared key onto a fresh object — so the
 * value handed to the check owns every field unconditionally, whatever the
 * input did. Written that way the rule cannot fail, and a test using a custom
 * prototype does not catch it: the survey refuses such an object as a non-record
 * before the rule is ever consulted, so the fixture never reaches the mechanism
 * and the assertion passes on a guard that does nothing.
 *
 * `in` rather than a read, so no getter on the prototype is invoked by the
 * check itself. A declared field named for a built-in — `constructor`,
 * `toString`, `valueOf` — would make this refuse every document; that is
 * covered without a dedicated assertion, because every test that parses a valid
 * document would fail at once rather than one test reporting it.
 */
function shadowedDeclaredField(fields: readonly string[]): string | undefined {
  return fields.find(field => field in Object.prototype);
}

/**
 * What `Object.prototype` carried when this module loaded.
 *
 * Captured rather than listed, so it is whatever the running engine considers
 * standard and cannot go stale when a future runtime adds a built-in.
 */
const PRISTINE_PROTOTYPE_KEYS: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype)
);

/**
 * Any name added to `Object.prototype` since this module loaded.
 *
 * This exists because the check below it could be DISARMED by the very thing it
 * looks for, which is the failure that matters more than the one it was written
 * for. {@link declaredFields} derives its list by emitting the JSON Schema, and
 * emitting that schema while `Object.prototype` carries `id`, `type`, `version`
 * and `props` produces **8** property names instead of 33 — the node's fields
 * vanish from it entirely. So the field list came back without the names being
 * attacked, found nothing to complain about, and a node inheriting every
 * required field parsed as valid.
 *
 * That is a guard reading data the attacker controls. This one reads a set
 * captured before any document was seen, so nothing a caller does afterwards
 * can change the answer, and it needs no knowledge of the schema at all.
 *
 * The gap it does NOT close, stated rather than implied: pollution that
 * predates this module's load is part of the captured baseline and is invisible
 * here. {@link shadowedDeclaredField} still covers that case whenever schema
 * emission is intact, which is why both run.
 */
function pollutedPrototypeKey(): string | undefined {
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    if (!PRISTINE_PROTOTYPE_KEYS.has(name)) return name;
  }
  return undefined;
}

/**
 * The fields a node must declare, as the one list this module states outright.
 *
 * A positive control for {@link declaredFields}: if the derived list does not
 * contain these, the emission that produced it was perturbed and its silence
 * means nothing. Four names, checked against a list of 33, is a cheap way to
 * tell "found no problem" apart from "could not look".
 */
const NODE_REQUIRED_FIELDS = ["id", "type", "version", "props"] as const;

/**
 * Every field name any object in the document declares.
 *
 * Read from the JSON Schema this module publishes, which is the one artefact
 * that already describes EVERY object reachable in a document — the envelope,
 * the node, and equally the nested shapes it is easy to forget: a binding's
 * `$bind` and `source`, a condition's `field` and `op`, a format's `currency`,
 * `settings`, `assets`. Naming the shapes by hand covered two of them and left
 * the rest, which is the same partial enumeration in a different costume.
 *
 * Derived rather than restated, so a field added to any schema above is
 * included without an edit here. `properties` is JSON Schema's own word for
 * "declared field", so the walk needs no knowledge of zod's internals and
 * cannot fall out of step with what is published.
 *
 * Built on first use, not at module scope. `blockNodeSchema`'s `slots` is a
 * getter naming the node schema, so emitting the JSON Schema while this module
 * is still initializing would reach it before it is bound.
 */
function collectDeclaredFields(node: unknown, into: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const entry of node) collectDeclaredFields(entry, into);
    return;
  }
  const record = node as Record<string, unknown>;
  const properties = record.properties;
  if (properties !== null && typeof properties === "object") {
    for (const name of Object.keys(properties)) into.add(name);
  }
  for (const value of Object.values(record)) collectDeclaredFields(value, into);
}

let declaredFieldsCache: string[] | undefined;

function declaredFields(): string[] {
  if (declaredFieldsCache === undefined) {
    const names = new Set<string>();
    collectDeclaredFields(blockDocumentJsonSchema(), names);
    declaredFieldsCache = [...names];
  }
  return declaredFieldsCache;
}

const blockDocumentObject = z.looseObject({
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

const blockDocumentSchema = blockDocumentObject;

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
  const schema = z.toJSONSchema(blockDocumentSchema, { io: "input" });

  // The emission is checked HERE rather than only where this module consumes
  // it, because publishing a corrupted schema is the worse of the two failures:
  // a caller writes it to a file, a generator or an external agent validates
  // against it, and it silently accepts malformed nodes long after this process
  // has exited.
  //
  // What corrupts it is prototype pollution. Emitting while `Object.prototype`
  // carries `id`, `type`, `version` and `props` returns EIGHT property names
  // instead of 33, with every node field missing — a shorter document rather
  // than an error, which is why nothing downstream notices.
  const emitted = new Set<string>();
  collectDeclaredFields(schema, emitted);
  const missing = NODE_REQUIRED_FIELDS.filter(field => !emitted.has(field));
  if (missing.length > 0) {
    throw new NextlyError({
      code: "SCHEMA_DERIVATION_FAILED",
      publicMessage:
        "The block document schema could not be derived, so it was not emitted.",
      logContext: {
        missing: [...missing],
        cause:
          "Object.prototype has been extended; zod's registry reads `id` off the object given to .meta(), so the emitted schema loses the node's fields and would describe a format that accepts malformed nodes.",
      },
    });
  }
  return schema;
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
  // FIRST, ahead of the survey. This is the cheapest condition and it decides
  // the verdict on its own, so anything done before it is work a refused
  // document got for free — and the survey is not merely work: an inherited
  // `toJSON` would be retrieved and INVOKED on the root and on every nested
  // object, so a polluted prototype could run arbitrary code inside the
  // precondition that exists to refuse it.
  const added = pollutedPrototypeKey();
  if (added !== undefined) {
    return {
      success: false,
      issues: [
        `Object.prototype has gained \`${added}\` since this module loaded, so every object in this document appears to hold fields it does not own.`,
      ],
    };
  }

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
        "Document holds a value JSON cannot represent unchanged (a BigInt, a function, a symbol, `undefined`, a non-finite number, `-0`, an object that is not a plain record, an unreadable accessor, or a circular reference).",
      ],
    };
  }

  // Checked before the schema runs, because it decides whether reading by
  // property access means anything at all here. With a declared name on
  // `Object.prototype`, every object in the document resolves that field
  // whether or not it holds one, so the schema would be validating values the
  // document does not contain and storage will not receive.
  const fields = declaredFields();
  // The positive control. A perturbed emission returns a SHORTER list rather
  // than an error, so "no declared field is shadowed" has to be distinguished
  // from "the list being searched was not the real one".
  const derivationIntact = NODE_REQUIRED_FIELDS.every(field =>
    fields.includes(field)
  );
  if (!derivationIntact) {
    return {
      success: false,
      issues: [
        "The published schema could not be derived, so this document cannot be checked against it.",
      ],
    };
  }

  const shadowed = shadowedDeclaredField(fields);
  if (shadowed !== undefined) {
    return {
      success: false,
      issues: [
        `Object.prototype carries \`${shadowed}\`, so every object in this document appears to hold a field storage would not receive.`,
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
