/**
 * A component definition's envelope: what it exposes, its slots and their
 * metadata, and its variants, each judged against the nodes it points at.
 *
 * @module validation-components
 */
import { isBindPath } from "./binding-rules";
import {
  type BlockDocument,
  type BlockNode,
  EXPOSED_PROPERTY_TYPES,
  isBlockType,
} from "./document";
import { describeValue, pointer } from "./issue-text";
import {
  DEFAULT_LIMITS,
  type DocumentLimits,
  MAX_ENVELOPE_ENTRIES,
} from "./limits";
import { boundedLimit } from "./measure-bytes";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys } from "./safe-record";
import { walkNodes } from "./tree";
import type { ValidationIssue } from "./validation-contract";

// ---------------------------------------------------------------------------
// The component definition envelope (`kind: "component"`)
// ---------------------------------------------------------------------------

/**
 * Every node in the forest, by id.
 *
 * Its own bounded walk rather than a share of the main one. The envelope needs
 * the WHOLE index before it can judge its first pointer, while the main walk
 * reports as it goes — so reusing it would mean either checking pointers
 * against a half-built index, or holding the envelope's issues back to the end
 * and reordering the report. A second walk of a component document, bounded by
 * the same snapshotted node cap, costs less than either.
 */
function nodesById(nodes: BlockNode[], maxNodes: number) {
  const index = new Map<string, BlockNode>();
  // The snapshotted node bound, so this walk and the survey that measured the
  // document agree on how many nodes there are. A caller may back
  // `DocumentLimits` with a getter, and two readings that disagree would build
  // an index missing a node the survey counted — reported as a sound exposure
  // pointing at nothing.
  walkNodes(
    nodes,
    node => {
      // First writer wins. A forest with a duplicated id is already reported by
      // the main walk, and overwriting here would make the envelope's answer
      // depend on traversal order for a document that is being refused anyway.
      if (!index.has(node.id)) index.set(node.id, node);
    },
    { maxNodes }
  );
  return index;
}

/**
 * Walk an untrusted array, bounded, without calling a method on it.
 *
 * Two hazards in one helper, because the envelope reads arrays a caller
 * supplied and both apply to every one of them.
 *
 * BOUNDED, on the collection's own terms. The survey measures what
 * `JSON.stringify` would emit, so a field carrying a `toJSON` returning `[]`
 * is measured as two bytes while this reads the real array by ordinary
 * property access — a document that passes a 200-byte survey can still hold a
 * hundred thousand entries. Nothing upstream bounds what is read here.
 *
 * BY INDEX, never `forEach`. The array is a caller's object, so its `forEach`
 * may be shadowed with a non-function, and validation would throw where its
 * whole contract is to RETURN issues about malformed input.
 *
 * @returns false when the collection was refused for its size, so a caller
 * skips the work rather than reporting a fault per entry on top of it.
 */
function eachBounded(
  items: readonly unknown[],
  path: string,
  what: string,
  issues: ValidationIssue[],
  visit: (entry: unknown, index: number) => void
): boolean {
  if (!withinBudget(items.length, path, what, issues)) return false;
  for (let i = 0; i < items.length; i += 1) visit(items[i], i);
  return true;
}

/** Report once when a collection is too large to be worth walking. */
function withinBudget(
  size: number,
  path: string,
  what: string,
  issues: ValidationIssue[]
): boolean {
  if (size <= MAX_ENVELOPE_ENTRIES) return true;
  issues.push({
    path,
    code: "component-envelope-invalid",
    severity: "error",
    message: `A component declares ${size} ${what}, more than the ${MAX_ENVELOPE_ENTRIES} an envelope may hold.`,
  });
  return false;
}

/**
 * The own keys of an untrusted record, or `null` when there are too many.
 *
 * Counted with `for...in` and stopped at the budget rather than materializing
 * `Object.keys` first: a map with a hundred thousand keys would otherwise be
 * enumerated into an array in full before anything could refuse it, which is
 * the allocation the budget exists to prevent.
 */
function ownKeysBounded(
  record: object,
  path: string,
  what: string,
  issues: ValidationIssue[]
): string[] | null {
  const keys = boundedOwnKeys(record, MAX_ENVELOPE_ENTRIES);
  if (keys !== null) return keys;
  // The walk stops AT the cap and reports nothing itself, so the number named
  // here is the smallest one that exceeds it rather than the record's real
  // size — which is the point of stopping, and why the enumeration and the
  // complaint are two functions.
  withinBudget(MAX_ENVELOPE_ENTRIES + 1, path, what, issues);
  return null;
}

/** One `exposed` entry, before anything about it has been checked. */
type RawExposed = Record<string, unknown>;

/** True when a record declares `key` itself rather than inheriting it. */
function declares(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Check a component definition's exposed properties, slots and variants.
 *
 * Every rule here is about a POINTER resolving or a field being present,
 * because those are the faults the envelope introduces and the ones nothing
 * downstream can report. A definition whose pointer names a deleted node still
 * loads, still renders, and still offers the property in the inspector — where
 * editing it writes an override keyed to an id that resolves to nothing, on
 * every instance in the site. The failure surfaces as "my change did nothing",
 * far from the definition that caused it.
 *
 * Errors, not warnings, and in both modes. Forgiving mode exists to keep a
 * document READABLE when a future build wrote something this one does not
 * understand; a dangling pointer is not a future value, it is a broken
 * reference to this document's own tree.
 */
export function validateComponentEnvelope(
  doc: Record<string, unknown>,
  nodes: BlockNode[],
  maxNodes: number,
  issues: ValidationIssue[]
): void {
  const index = nodesById(nodes, maxNodes);
  const exposedIds = checkExposedList(doc.exposed, index, issues);
  checkExposedSlots(doc.slots, index, issues);
  checkVariants(doc.variants, exposedIds, issues);
}

/**
 * The issues a component definition's ENVELOPE would be refused for, alone.
 *
 * The same walk `validateDocument` runs for a `kind: "component"`
 * document, published so a planner can ask it before it proposes storing one.
 *
 * Narrow deliberately, and the narrowness is what makes it reachable from a
 * planner at all. Full validation needs a breakpoint set, and a planner has
 * none: breakpoints are the host's configuration and a plan is pure. The
 * envelope rules need none of it — they resolve pointers against the
 * document's own forest and nothing else, which is why this question can be
 * asked in isolation where the style and class ones cannot.
 *
 * The alternative is a planner that re-implements "does this pointer resolve",
 * and one rule spelled twice is the failure this package keeps paying for: the
 * two readings agree until one moves, and the one that moves is the one nobody
 * is looking at. A dry run that disagrees with the gate it predicts is worse
 * than no dry run, because it is believed.
 *
 * Every issue it can return is an `error` in both modes — a dangling pointer
 * is a broken reference to this document's own tree rather than a value a
 * future build understands — except `variant-empty`, a `warning`: a variant a
 * field's removal emptied is kept and renders the defaults. A caller deciding
 * whether to refuse reads the errors.
 *
 * Empty for a document that is not a component, matching where the per-kind
 * rules run: a pattern has no envelope to be wrong about, and answering
 * otherwise would make "no issues" mean two different things.
 *
 * The node array is read defensively because this is a published entry point
 * and the value reaching it comes from a stored row as often as from a typed
 * caller. A corrupt forest is reported by the main walk; refusing to index it
 * here would throw where this module promises to answer.
 */
export function componentEnvelopeIssues(
  doc: BlockDocument,
  limits: DocumentLimits = DEFAULT_LIMITS
): ValidationIssue[] {
  // The DOCUMENT, before its kind is read off it. This is a published entry
  // point whose own docblock names a stored row as an input, and a row can be
  // `null` or a string — where dereferencing `.kind` throws a native error out
  // of a function that promises a list. Whether such a document is READABLE at
  // all is `validateDocument`'s question and a planner asks it separately; this
  // one answers only about an envelope, and an unreadable document has none.
  if (!isPlainRecord(doc) || doc.kind !== "component") return [];
  const issues: ValidationIssue[] = [];
  validateComponentEnvelope(
    doc,
    Array.isArray(doc.nodes) ? doc.nodes : [],
    // Through the SAME rule the survey applies, because a bound that is not a
    // number is not a bound: every comparison against `NaN` in the walk is
    // false, so the index is built over the whole forest and a dangling pointer
    // is reported as sound — with the resource bound gone as well as the
    // verdict wrong. `validateDocument`, the gate this predicts, refuses those
    // limits outright, so accepting them here is the dry run disagreeing with
    // the thing it exists to foresee.
    boundedLimit(limits.maxNodes, "maxNodes", "componentEnvelopeIssues"),
    issues
  );
  return issues;
}

/**
 * The `exposed` list, returning the ids it declared.
 *
 * The ids are the return value because the variants below address them: a
 * variant preset naming something nothing exposes is applied by no one, and
 * only this pass knows what was named.
 */
function checkExposedList(
  exposed: unknown,
  index: Map<string, BlockNode>,
  issues: ValidationIssue[]
): ReadonlySet<string> {
  const exposedIds = new Set<string>();
  if (exposed === undefined) return exposedIds;

  if (!Array.isArray(exposed)) {
    issues.push({
      path: "/exposed",
      code: "component-envelope-invalid",
      severity: "error",
      message: "A component's exposed field must be an array.",
    });
    return exposedIds;
  }

  eachBounded(exposed, "/exposed", "exposed properties", issues, (entry, i) => {
    checkExposedProperty(entry, `/exposed/${i}`, index, exposedIds, issues);
  });
  return exposedIds;
}

/** The `slots` map, keyed by the id an instance addresses its content with. */
function checkExposedSlots(
  slots: unknown,
  index: Map<string, BlockNode>,
  issues: ValidationIssue[]
): void {
  if (slots === undefined) return;

  if (!isPlainRecord(slots)) {
    issues.push({
      path: "/slots",
      code: "component-envelope-invalid",
      severity: "error",
      message: "A component's slots field must be an object keyed by slot id.",
    });
    return;
  }

  const ids = ownKeysBounded(slots, "/slots", "exposed slots", issues);
  if (ids === null) return;

  for (const id of ids) {
    checkExposedSlot(slots[id], id, pointer("/slots", id), index, issues);
  }
}

/**
 * One exposed property.
 *
 * Split three ways — identity, pointer, options — rather than checked in one
 * pass, because the id has to be established before anything else can be
 * REPORTED. Every message below names the exposure, and an entry with no
 * usable id is one the author cannot pick out of a list whose entries
 * otherwise look alike.
 */
function checkExposedProperty(
  entry: unknown,
  path: string,
  index: Map<string, BlockNode>,
  seen: Set<string>,
  issues: ValidationIssue[]
): void {
  if (!isPlainRecord(entry)) {
    issues.push({
      path,
      code: "exposed-property-invalid",
      severity: "error",
      message: "An exposed property must be an object.",
    });
    return;
  }

  const raw: RawExposed = entry;
  const id = checkExposedIdentity(raw, path, seen, issues);
  if (id === undefined) return;

  checkExposedPointer(raw, id, path, index, issues);
  checkExposedOptions(raw.options, raw.type, id, path, issues);
}

/**
 * The id, its uniqueness and the label; returns the id when it is usable.
 *
 * `undefined` stops the caller rather than letting it report the remaining
 * faults against an entry it has no way to name.
 */
function checkExposedIdentity(
  raw: RawExposed,
  path: string,
  seen: Set<string>,
  issues: ValidationIssue[]
): string | undefined {
  const id = raw.id;
  if (typeof id !== "string" || id === "") {
    issues.push({
      path: pointer(path, "id"),
      code: "exposed-property-invalid",
      severity: "error",
      message: "An exposed property needs a non-empty id.",
    });
    return undefined;
  }

  // Reported against the SECOND entry, so one message names one thing to fix
  // rather than two that each read as unrelated.
  if (seen.has(id)) {
    issues.push({
      path: pointer(path, "id"),
      code: "exposed-duplicate-id",
      severity: "error",
      message: `Two exposed properties share the id "${id}".`,
      suggestion: "Give each exposed property its own id.",
    });
  }
  seen.add(id);

  if (typeof raw.label !== "string" || raw.label === "") {
    issues.push({
      path: pointer(path, "label"),
      code: "exposed-property-invalid",
      severity: "error",
      message: `Exposed property "${id}" needs a non-empty label.`,
    });
  }

  return id;
}

/** Where the exposure points: its type, its node, and the prop path on it. */
function checkExposedPointer(
  raw: RawExposed,
  id: string,
  path: string,
  index: Map<string, BlockNode>,
  issues: ValidationIssue[]
): void {
  const type = raw.type;
  if (
    !EXPOSED_PROPERTY_TYPES.includes(
      type as (typeof EXPOSED_PROPERTY_TYPES)[number]
    )
  ) {
    issues.push({
      path: pointer(path, "type"),
      code: "exposed-property-invalid",
      severity: "error",
      message: `Exposed property "${id}" declares an unknown type ${describeValue(type)}.`,
      suggestion: `Use one of: ${EXPOSED_PROPERTY_TYPES.join(", ")}.`,
    });
  }

  const nodeId = raw.nodeId;
  if (typeof nodeId !== "string" || !index.has(nodeId)) {
    issues.push({
      path: pointer(path, "nodeId"),
      code: "exposed-node-missing",
      severity: "error",
      message: `Exposed property "${id}" points at node ${describeValue(nodeId)}, which this document does not contain.`,
      suggestion:
        "Point it at a node in this component's tree, or remove the exposure.",
    });
  }

  // The GRAMMAR only. Whether the path names a prop the node's block actually
  // declares is a question about the block's schema, and the schema is not
  // reachable from here — `BlockTypeLookup` answers `has(type)` and nothing
  // else. Checking the path against `node.props` instead would refuse a sound
  // exposure of any prop whose value comes from the block's default, since a
  // defaulted prop is absent from the stored node.
  const propPath = raw.propPath;
  if (!isBindPath(propPath)) {
    issues.push({
      path: pointer(path, "propPath"),
      code: "exposed-path-invalid",
      severity: "error",
      message: `Exposed property "${id}" has prop path ${describeValue(propPath)}.`,
      suggestion: 'Use a dot-joined chain of field identifiers, e.g. "text".',
    });
  }
}

/**
 * The options list, which only a `select` may carry.
 *
 * Checked in both directions. Options on a non-select are dead configuration
 * the inspector will not read, and a select WITHOUT them offers a control with
 * nothing to choose — which reads to an author as a broken editor rather than
 * as an incomplete definition.
 */
function checkExposedOptions(
  options: unknown,
  type: unknown,
  id: string,
  path: string,
  issues: ValidationIssue[]
): void {
  const isSelect = type === "select";

  if (!isSelect) {
    if (options !== undefined) {
      issues.push({
        path: pointer(path, "options"),
        code: "exposed-options-invalid",
        severity: "error",
        message: `Exposed property "${id}" declares options but is not a select.`,
      });
    }
    return;
  }

  if (!Array.isArray(options) || options.length === 0) {
    issues.push({
      path: pointer(path, "options"),
      code: "exposed-options-invalid",
      severity: "error",
      message: `Exposed property "${id}" is a select and needs at least one option.`,
    });
    return;
  }

  const at = pointer(path, "options");
  const seen = new Set<string>();
  eachBounded(options, at, "select options", issues, (option, i) => {
    if (
      !isPlainRecord(option) ||
      typeof option.value !== "string" ||
      typeof option.label !== "string"
    ) {
      issues.push({
        // One segment per call. `pointer` escapes its token whole, so a single
        // call with "options/0" emits `options~10` — a pointer that resolves
        // to nothing, in the field whose purpose is to let a machine locate
        // the value.
        path: pointer(at, i),
        code: "exposed-options-invalid",
        severity: "error",
        message: `An option of exposed property "${id}" needs a string value and label.`,
      });
      return;
    }

    // An override stores only the VALUE, so two options sharing one cannot be
    // told apart after the author chooses: the menu shows two labels and both
    // resolve identically, with nothing recording which was picked.
    if (seen.has(option.value)) {
      issues.push({
        path: pointer(at, i),
        code: "exposed-options-invalid",
        severity: "error",
        message: `Exposed property "${id}" offers the value "${option.value}" twice.`,
        suggestion: "Give each option its own value.",
      });
      return;
    }
    seen.add(option.value);
  });
}

/** One exposed slot: its metadata, its node, and the region on that node. */
function checkExposedSlot(
  entry: unknown,
  id: string,
  path: string,
  index: Map<string, BlockNode>,
  issues: ValidationIssue[]
): void {
  // The map KEY is the slot's id, and an empty one is unusable rather than
  // merely odd: instance content is stored under it in the instance node's own
  // `slots`, and the builder's operation boundary refuses an empty slot name —
  // so an exposure accepted here is one no author can ever fill.
  if (id === "") {
    issues.push({
      path,
      code: "component-envelope-invalid",
      severity: "error",
      message: "An exposed slot needs a non-empty id.",
    });
    return;
  }

  if (!isPlainRecord(entry)) {
    issues.push({
      path,
      code: "component-envelope-invalid",
      severity: "error",
      message: `Exposed slot "${id}" must be an object.`,
    });
    return;
  }

  checkExposedSlotMetadata(entry, id, path, issues);

  const nodeId = entry.nodeId;
  const node = typeof nodeId === "string" ? index.get(nodeId) : undefined;
  if (node === undefined) {
    issues.push({
      path: pointer(path, "nodeId"),
      code: "exposed-node-missing",
      severity: "error",
      message: `Exposed slot "${id}" points at node ${describeValue(nodeId)}, which this document does not contain.`,
    });
    return;
  }

  checkSlotOnNode(entry.slot, node, id, path, issues);
}

/**
 * The label the layers panel shows, and the block types the slot accepts.
 *
 * Both are read straight out of the stored envelope by consumers that treat
 * the declared types as guarantees: a missing label renders as `undefined` in
 * the panel, and an `allow` that is a bare string is iterated character by
 * character, silently permitting nothing.
 */
function checkExposedSlotMetadata(
  entry: Record<string, unknown>,
  id: string,
  path: string,
  issues: ValidationIssue[]
): void {
  if (typeof entry.label !== "string" || entry.label === "") {
    issues.push({
      path: pointer(path, "label"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Exposed slot "${id}" needs a non-empty label.`,
    });
  }

  const allow = entry.allow;
  if (allow === undefined) return;
  if (!Array.isArray(allow)) {
    issues.push({
      path: pointer(path, "allow"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Exposed slot "${id}" allow must be an array of block types.`,
    });
    return;
  }

  const at = pointer(path, "allow");
  eachBounded(allow, at, "allowed block types", issues, (type, i) => {
    // The same predicate the rest of validation holds a node's `type` to. A
    // second, weaker definition here would accept `"not-a-block"` as a block
    // type in the one place the field's whole purpose is naming block types.
    if (isBlockType(type)) return;
    issues.push({
      path: pointer(at, i),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Exposed slot "${id}" allows ${describeValue(type)}, which is not a block type.`,
    });
  });
}

/**
 * That the node holds the named region.
 *
 * Answered from the node's STORED slots, which is what this package can see: a
 * block's declared slots live in its definition, and validation is given a
 * `BlockTypeLookup` that answers `has(type)` and nothing else. So this catches
 * the case it can — a slot key the node's own content does not use, which is
 * what a renamed container leaves behind — and cannot catch a slot that the
 * block definition no longer declares but whose content is still stored.
 *
 * A node with NO slots map is passed, deliberately. `makeNode` sets `slots`
 * only when a caller supplies content and `expandSlotDefaults` returns nothing
 * for a container with no seeded children, so a declared, still-empty region
 * is stored as an absent map — indistinguishable from a region that never
 * existed. Refusing that would reject a sound definition for exposing a slot
 * the author has not filled yet, which is the ordinary state of a container
 * the moment it is created.
 *
 * An OWN property when there is a map. `slots` is an ordinary object, so
 * `"toString" in slots` is true of every node, and a slot by that name would
 * otherwise pass and then resolve to nothing.
 */
function checkSlotOnNode(
  slot: unknown,
  node: BlockNode,
  id: string,
  path: string,
  issues: ValidationIssue[]
): void {
  // The NAME first, before any question about the node. A slot field that is
  // missing, numeric or empty is wrong whatever the node holds, and answering
  // the node question first let an empty container accept `undefined` as a
  // region name — handing a consumer the one value the contract promises it
  // will never see.
  if (typeof slot !== "string" || slot === "") {
    issues.push({
      path: pointer(path, "slot"),
      code: "exposed-slot-missing",
      severity: "error",
      message: `Exposed slot "${id}" names ${describeValue(slot)}, which is not a slot name.`,
    });
    return;
  }

  // A stored `slots` that is not a record is the main node walk's to report as
  // `invalid-slots`. Reading it here first would reach `hasOwnProperty.call`
  // with `null` and throw — turning a malformed import, which this function
  // exists to describe, into a crash that describes nothing.
  const declared = node.slots;
  if (!isPlainRecord(declared)) return;
  if (declares(declared, slot)) return;

  issues.push({
    path: pointer(path, "slot"),
    code: "exposed-slot-missing",
    severity: "error",
    message: `Exposed slot "${id}" names slot "${slot}", which node "${node.id}" does not hold.`,
    suggestion: `Name one of: ${Object.keys(declared).join(", ") || "(none)"}.`,
  });
}

/**
 * Variants, checked against what the definition actually exposes.
 *
 * A variant is a preset of overrides, so every key it sets has to name
 * something an instance could set itself. A key naming nothing is applied by
 * no one and reported by nothing: the variant appears in the picker, selecting
 * it changes nothing, and the definition looks broken rather than
 * misconfigured.
 */
function checkVariants(
  variants: unknown,
  exposedIds: ReadonlySet<string>,
  issues: ValidationIssue[]
): void {
  if (variants === undefined) return;
  if (!isPlainRecord(variants)) {
    issues.push({
      path: "/variants",
      code: "component-envelope-invalid",
      severity: "error",
      message:
        "A component's variants field must be an object keyed by variant id.",
    });
    return;
  }

  const names = ownKeysBounded(variants, "/variants", "variants", issues);
  if (names === null) return;

  for (const name of names) {
    checkVariant(name, variants[name], exposedIds, issues);
  }
}

/** One variant: its label, and the exposures its overrides address. */
function checkVariant(
  name: string,
  variant: unknown,
  exposedIds: ReadonlySet<string>,
  issues: ValidationIssue[]
): void {
  const at = pointer("/variants", name);
  if (!isPlainRecord(variant)) {
    issues.push({
      path: at,
      code: "component-envelope-invalid",
      severity: "error",
      message: `Variant "${name}" must be an object.`,
    });
    return;
  }

  if (typeof variant.label !== "string" || variant.label === "") {
    issues.push({
      path: pointer(at, "label"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Variant "${name}" needs a non-empty label.`,
    });
  }

  // Required AND non-empty. A variant is a preset, and the picker offering one
  // that presets nothing is a control that does nothing when chosen. An empty
  // map is that control exactly, so checking only the type would state the
  // invariant in the comment and enforce a weaker one in the code.
  if (!isPlainRecord(variant.overrides)) {
    issues.push({
      path: pointer(at, "overrides"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Variant "${name}" needs an overrides object keyed by exposed id.`,
    });
  } else {
    // Bounded HERE, not only at the variant map. `variants` being within the
    // budget says nothing about one variant's overrides, so a single variant
    // holding a hundred thousand keys reached both the emptiness check and the
    // per-key walk below — twice — through a cap that had already passed.
    const overrideKeys = ownKeysBounded(
      variant.overrides,
      pointer(at, "overrides"),
      "variant overrides",
      issues
    );
    if (overrideKeys === null) return;

    // A warning, not a refusal. Removing an exposed field prunes it from every
    // variant in the same save, so a variant whose only value that was is left
    // empty by a legitimate edit; refusing it would refuse the removal itself.
    // It renders the component's defaults, and the picker can say so. The
    // checks after this one still run: a warning ends nothing.
    if (overrideKeys.length === 0) {
      issues.push({
        path: pointer(at, "overrides"),
        code: "variant-empty",
        severity: "warning",
        message: `Variant "${name}" presets nothing, so selecting it shows the component's defaults.`,
        suggestion: "Give it at least one value, or remove the variant.",
      });
    }

    checkVariantTargets(
      overrideKeys,
      exposedIds,
      pointer(at, "overrides"),
      key =>
        `Variant "${name}" overrides "${key}", which this component does not expose.`,
      issues
    );
  }

  // `slots` carries no content in this format yet, so a variant naming one can
  // only be addressing a slot id — see `Variant` in `document.ts`.
  if (variant.slots !== undefined) {
    issues.push({
      path: pointer(at, "slots"),
      code: "component-envelope-invalid",
      severity: "error",
      message: `Variant "${name}" declares slot content, which this format version does not carry.`,
      suggestion: "Put the content in the instance's own slots.",
    });
  }
}

/**
 * A variant's override map, against the ids the definition exposes.
 *
 * The keys are the whole check: a value may be anything an exposed property
 * holds, and props are unconstrained, so there is nothing narrower to say
 * about one than that its key names something.
 */
function checkVariantTargets(
  keys: readonly string[],
  known: ReadonlySet<string>,
  at: string,
  message: (key: string) => string,
  issues: ValidationIssue[]
): void {
  // Takes the KEYS a bounded read already produced, rather than the map. Given
  // the map it would enumerate a second time, so one collection would be
  // counted once and walked twice — and the second walk had no bound at all.
  for (const key of keys) {
    if (known.has(key)) continue;
    issues.push({
      // One segment per call: `pointer` escapes its token whole, so passing
      // "overrides/missing" emits `overrides~1missing`, which resolves to
      // nothing.
      path: pointer(at, key),
      code: "variant-unknown-target",
      severity: "error",
      message: message(key),
    });
  }
}
