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
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  MAX_DEPTH,
  STYLE_STATES,
} from "@nextlyhq/blocks-engine/format";
import type { DocumentKind, StyleState } from "@nextlyhq/blocks-engine/format";
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
 * One state × breakpoint bucket of style values.
 *
 * Values are unconstrained, and the token reference is described in prose
 * rather than modelled here. An earlier version accepted
 * `union([tokenRef, unknown])` to carry the token shape into the published
 * schema; because an object schema strips what it does not declare, a value
 * like `{ $token: "brand.primary", extra: true }` matched the token branch,
 * came back as a clean token reference, and hid the extra key the engine
 * rejects. The union bought documentation and paid for it by silently
 * repairing invalid input, which is the worse half of that trade.
 *
 * The catalog is additive-open besides, so enumerating today's properties
 * would start refusing documents the moment it grew.
 */
const styleValuesSchema = z.record(z.string(), z.unknown());

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
  z.record(z.string(), styleValuesSchema)
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
  devices: z.record(z.string(), z.boolean()).optional(),
});

/** Locale-aware display formatting for a bound value. */
const bindingFormatSchema = z.union([
  z.object({
    type: z.literal("date"),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("number"),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("currency"),
    currency: z.string(),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("relativeTime"),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("list"),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
]);

/**
 * A binding: a typed field path, never an expression.
 *
 * `sourceKey` is required for `single` and meaningless for every other source,
 * because a single is addressed by slug while the others are implied by the
 * render context. Stated as a union so a document naming a single without
 * saying which one fails here rather than resolving to nothing at read time.
 */
const bindingSchema = z.union([
  z.object({
    $bind: z.string(),
    fallback: z.unknown().optional(),
    format: bindingFormatSchema.optional(),
    source: z.enum(["entry", "item", "site"]).optional(),
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
  z.object({
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
  props: z.record(z.string(), z.unknown()),
  bindings: z.record(z.string(), bindingSchema).optional(),
  get slots() {
    return z.record(z.string(), z.array(blockNodeSchema)).optional();
  },
  styles: nodeStylesSchema.optional(),
  classes: z.array(z.string()).optional(),
  visibility: nodeVisibilitySchema.optional(),
  locked: z.boolean().optional(),
  name: z.string().optional(),
  customCss: z.string().optional(),
  cssId: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
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
 * Whether a value nests deeper than the format allows, measured WITHOUT
 * recursion.
 *
 * The schema is self-referential, so parsing a deeply nested value walks it
 * with the call stack: a long enough slot chain raises `RangeError: Maximum
 * call stack size exceeded` before any validation runs. This entry point is
 * published for checking documents produced elsewhere, so that input is
 * untrusted by definition and a crafted one would take down the process doing
 * the checking rather than being reported as invalid.
 *
 * An explicit stack makes depth a value to compare instead of a limit the
 * runtime discovers. It walks slots only, which is where the format nests;
 * every other field bottoms out in data.
 *
 * The bound comes from the engine so there is one answer to "how deep may a
 * document be" rather than two that agree until one is edited.
 */
function nestsTooDeep(value: unknown, max: number): boolean {
  if (typeof value !== "object" || value === null) return false;

  // Seeded from the envelope's `nodes`, because that is where a document's
  // tree starts. Seeding from the document itself walks nothing: the envelope
  // has no `slots`, so the first iteration finds none and the pass reports a
  // depth of zero for a document of any shape.
  const roots = (value as { nodes?: unknown }).nodes;
  if (!Array.isArray(roots)) return false;

  const stack: Array<{ node: unknown; depth: number }> = roots.map(node => ({
    node,
    depth: 1,
  }));

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > max) return true;
    if (typeof node !== "object" || node === null) continue;

    const slots = (node as { slots?: unknown }).slots;
    if (typeof slots !== "object" || slots === null) continue;

    for (const children of Object.values(slots as Record<string, unknown>)) {
      if (!Array.isArray(children)) continue;
      for (const child of children) {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return false;
}

/**
 * Check a value against the block document format.
 *
 * This is the entry point to use on a document you did not write. It applies
 * the depth bound first, so a hostile or merely broken input is REPORTED as
 * invalid rather than exhausting the stack, and only then runs the schema.
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
  if (nestsTooDeep(value, MAX_DEPTH)) {
    return {
      success: false,
      issues: [`Document nests deeper than the format allows (${MAX_DEPTH}).`],
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

  return { success: true, data: result.data as BlockDocument };
}
