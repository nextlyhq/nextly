/**
 * Letting a plugin MODIFY another plugin's entities, not only add to them.
 *
 * A plugin can already add fields to any entity through `contributes.extend`.
 * What it cannot do is change one — because `setup(config)` runs before plugin
 * schema contributions are merged, so it never sees another plugin's
 * collections at all. Payload plugins receive the whole config, earlier
 * plugins' collections included, and can change anything in it.
 *
 * Transforms run AFTER everything is merged, which is the only point at which
 * "another plugin's collection" exists to be changed.
 *
 * ## What a transform can target
 *
 * Code-first entities — the app's own and every plugin's — because those are
 * the entities in the merged config when transforms run. A Schema Builder
 * entity is not: it is stored data, read from the database after the config is
 * folded, and a transform's output (hooks, access rules, validators) cannot be
 * stored there. Adding fields to a Builder entity is what `extend` is for, and
 * it is deferred until the Builder set is readable; changing one is done in the
 * Schema Builder. A transform naming a Builder slug is refused like any other
 * slug the config does not declare.
 *
 * ## A disabled plugin's transforms shape storage, not behaviour
 *
 * A disabled plugin keeps its schema — the fold runs over every plugin so
 * turning one off never changes a table — and runs none of its code at request
 * time. A transform can do both at once: add a field (a column) and attach a
 * hook. So a disabled plugin's transform still runs, and the behaviour it
 * touched is put back to what the entity carried before it ran: functions,
 * `access` values of any form, and hook lists are restored whole, so a hook,
 * access rule, validator or function default it added is dropped and one it
 * replaced or removed comes back. Its structural changes — the fields and
 * settings that decide storage — stay. See `withBehaviourOf`.
 *
 * ## Why each transform gets a frozen copy
 *
 * A transform returns a new definition rather than mutating the one it was
 * given. Mutation would make the result depend on whether a later transform
 * happened to read a field before or after an earlier one wrote it — and that
 * ordering is invisible in the config, so the bug would present as a plugin
 * that works until another is installed.
 *
 * @module plugins/entity-transforms
 * @since 1.0.0
 */
import { ALL_FIELD_TYPES } from "../collections/fields/types";
import { NextlyError } from "../errors/nextly-error";
import { copyPlainValues } from "../shared/lib/plain-copy";

import {
  assertMayTransform,
  openLedger,
  settleTransform,
  type OwnershipLedger,
  type TransformingPlugin,
} from "./entity-transform-ownership";

export type EntityKind = "collection" | "single" | "component";

export interface EntityTransform {
  /**
   * Entity slug(s): the app's code-first entities or any plugin's. Not a
   * Schema Builder entity — see the module doc.
   */
  target: string | string[];
  kind?: EntityKind;
  transform: (
    entity: Readonly<Record<string, unknown>>
  ) => Record<string, unknown>;
}

export interface TransformContribution {
  /** `plugin:<name>`, for attribution when one throws. */
  source: string;
  /** The plugin's name, which what its transforms add is recorded under. */
  name: string;
  /**
   * The plugins it declares in `dependsOn`: the owners whose entities it may
   * transform, and the contributors whose rules it may replace. See
   * `entity-transform-ownership`.
   */
  dependsOn?: readonly string[];
  transforms: readonly EntityTransform[];
  /**
   * The contributing plugin is disabled: its transforms keep their storage
   * changes and contribute no behaviour. See the module doc.
   */
  disabled?: boolean;
}

export interface TransformableEntity {
  slug: string;
  kind: EntityKind;
  definition: Record<string, unknown>;
  /** The plugin that declared the entity; absent for the app's own. */
  owner?: string;
  /** Top-level field name → the plugin that added it with `extend`. */
  extendedBy?: ReadonlyMap<string, string>;
}

function targets(transform: EntityTransform): string[] {
  return Array.isArray(transform.target)
    ? transform.target
    : [transform.target];
}

/**
 * Run every transform, in the order given, over the merged entities.
 *
 * `contributions` must already be in topological plugin order — the same
 * order schema hooks run in, and for the same reason: a plugin transforming a
 * dependency's collection must see it as the dependency left it.
 */
export function runEntityTransforms(
  entities: readonly TransformableEntity[],
  contributions: readonly TransformContribution[]
): TransformableEntity[] {
  const bySlug = new Map(
    entities.map(entity => [
      `${entity.kind}\u0000${entity.slug}`,
      { ...entity },
    ])
  );
  // Who put each part of each entity there, carried from one transform to
  // the next so a later transform is judged by what earlier ones added.
  const ledgers = new Map(
    [...bySlug].map(([key, entity]) => [key, openLedger(entity)])
  );

  for (const contribution of contributions) {
    for (const [position, transform] of contribution.transforms.entries()) {
      for (const slug of targets(transform)) {
        applyOne(bySlug, ledgers, contribution, transform, slug, position);
      }
    }
  }

  return [...bySlug.values()];
}

/** The entities one transform targets, or a refusal naming the missing slug. */
function matchesFor(
  bySlug: ReadonlyMap<string, TransformableEntity>,
  contribution: TransformContribution,
  transform: EntityTransform,
  slug: string,
  position: number
): [string, TransformableEntity][] {
  const matches = [...bySlug.entries()].filter(
    ([, entity]) =>
      entity.slug === slug &&
      (transform.kind === undefined || entity.kind === transform.kind)
  );
  if (matches.length > 0) return matches;

  // Refused rather than ignored. A transform naming an entity that is not
  // there is a typo or a missing dependency, and doing nothing silently means
  // the plugin appears installed and simply has no effect — the hardest kind
  // of "working" to diagnose.
  throw NextlyError.validation({
    errors: [
      {
        path: `${contribution.source}.transform[${String(position)}]`,
        code: "INVALID",
        // Names the Builder case, because a Builder slug is the one a
        // correct-looking target most often is: it exists, just not in the
        // config transforms run over.
        message: `Transform targets "${slug}", which no code-first ${transform.kind ?? "entity"} declares. Transforms change the app's and plugins' entities; a Schema Builder entity is changed in the Schema Builder, and \`extend\` adds fields to one.`,
      },
    ],
  });
}

/** Run one transform over one entity, with attribution on failure. */
function transformOne(
  entity: { definition: Record<string, unknown> },
  contribution: TransformContribution,
  transform: EntityTransform,
  slug: string,
  position: number
): Record<string, unknown> {
  const path = `${contribution.source}.transform[${String(position)}]`;
  const next = invokeTransform(entity, contribution, transform, slug, position);
  if (typeof next !== "object" || next === null) {
    throw NextlyError.validation({
      errors: [
        {
          path,
          code: "INVALID",
          message: `Transform of "${slug}" returned ${next === null ? "null" : typeof next}. It must return the new entity definition.`,
        },
      ],
    });
  }
  const returned = next as Record<string, unknown>;
  assertSlugKept(entity.definition.slug, returned.slug, path, slug);
  return returned;
}

/**
 * Call the transform on a frozen copy, turning anything it throws other than
 * a `NextlyError` into one that names the plugin and the transform.
 */
function invokeTransform(
  entity: { definition: Record<string, unknown> },
  contribution: TransformContribution,
  transform: EntityTransform,
  slug: string,
  position: number
): unknown {
  try {
    // Frozen ALL THE WAY DOWN, so a transform that mutates instead of
    // returning fails loudly here rather than making the result depend on
    // transform order.
    //
    // `Object.freeze({ ...definition })` froze only the outer object. The
    // spread copies references, so `entity.fields.push(...)` and
    // `entity.fields[0].name = "x"` reached the arrays and field objects of
    // the ORIGINAL config, changed it in place, and then returned normally —
    // the guard this comment promises, silently absent exactly where it
    // matters most.
    return transform.transform(
      copyPlainValues(entity.definition, { freeze: true, copyInstances: true })
    );
  } catch (cause) {
    if (cause instanceof NextlyError) throw cause;
    throw NextlyError.internal({
      cause: cause instanceof Error ? cause : undefined,
      logContext: {
        reason: "entity transform failed",
        source: contribution.source,
        target: slug,
        transformIndex: position,
      },
    });
  }
}

/**
 * A transform reshapes an entity; it does not become a different one.
 *
 * Returning a different `slug` left the map key and the outer `entity.slug`
 * as they were while the returned definition carried the new one. Two things
 * followed, both silent: transforms run AFTER slug-collision validation, so
 * renaming `posts` to `users` produced two configured entities claiming
 * `users` and nothing re-checked it; and every later transform still matched
 * on `posts`, so none could target what the entity now called itself.
 *
 * Refused rather than re-keyed. Re-keying would have to re-run collision
 * validation and re-resolve the targets of transforms already applied, and
 * a rename is not what this hook is for — `remapEntities` is.
 */
function assertSlugKept(
  declared: unknown,
  returned: unknown,
  path: string,
  slug: string
): void {
  if (returned === declared) return;
  // A definition with no slug, or a slug that is not a string, is not the
  // entity at all: the registries and the schema pipeline key every entity
  // by it, so it is refused like a rename rather than passed on.
  const returnedSlug =
    typeof returned === "string"
      ? `slug "${returned}"`
      : returned === undefined
        ? "no slug"
        : `a ${typeof returned} slug`;
  throw NextlyError.validation({
    errors: [
      {
        path,
        code: "INVALID",
        message: `Transform of "${slug}" returned a definition with ${returnedSlug}. A transform may reshape an entity but not rename it — keep its slug "${String(declared)}": slug collisions are validated before transforms run, and later transforms still target the declared slug. Use remapEntities to rename.`,
      },
    ],
  });
}

/** The contributing plugin, as the ownership ledger judges it. */
function transformingPlugin(
  contribution: TransformContribution,
  position: number
): TransformingPlugin {
  return {
    name: contribution.name,
    dependsOn: new Set(contribution.dependsOn ?? []),
    path: `${contribution.source}.transform[${String(position)}]`,
  };
}

function applyOne(
  bySlug: Map<string, TransformableEntity>,
  ledgers: Map<string, OwnershipLedger>,
  contribution: TransformContribution,
  transform: EntityTransform,
  slug: string,
  position: number
): void {
  const plugin = transformingPlugin(contribution, position);
  for (const [key, entity] of matchesFor(
    bySlug,
    contribution,
    transform,
    slug,
    position
  )) {
    const ledger = ledgers.get(key) ?? openLedger(entity);
    // Before the transform runs: a plugin without the dependency has no
    // business running code over the entity at all.
    assertMayTransform(entity.slug, ledger, plugin);
    const transformed = transformOne(
      entity,
      contribution,
      transform,
      slug,
      position
    );
    const definition =
      contribution.disabled === true
        ? withBehaviourOf(entity.definition, transformed)
        : transformed;
    // Judged on what will be registered, so a disabled plugin's result is
    // judged after its behaviour has been put back.
    ledgers.set(
      key,
      settleTransform(entity, ledger, entity.definition, definition, plugin)
    );
    bySlug.set(key, { ...entity, definition });
  }
}

/** Marks a function position the result must not carry. */
const DROP = Symbol("drop");

/** A plain object or array: the values behaviour can sit inside. */
function isContainer(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Whether `value` is, or holds anywhere inside it, a function. */
function holdsFunction(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (!isContainer(value)) return false;
  return Object.values(value).some(holdsFunction);
}

/**
 * `after`'s structure with `before`'s behaviour.
 *
 * Behaviour is what runs or decides at request time:
 *
 * - every function — a hook, a validator, a function default;
 * - every `access` value, whatever its form: `read: true` decides who reads as
 *   surely as `read: fn` does, so an `access` block is taken whole from
 *   `before`, or left out when `before` had none;
 * - every list of functions — a hook list — taken whole from `before`. Pairing
 *   a hook list's entries by position would let a removed entry shift the
 *   rest, and an emptied list is a removal of behaviour like any other.
 *
 * Everything else — the fields, their types and the settings that decide
 * storage — is `after`'s. A value `before` held behaviour under and `after`
 * removed or blanked is put back.
 *
 * Other arrays pair their elements by `name` when they carry one (a field
 * keeps its identity when others are inserted before it), by position
 * otherwise. An element `after` removed stays removed: removing a field is a
 * storage change.
 */
function withBehaviourOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, unknown> {
  const merged = mergeBehaviour(
    before,
    after,
    "schema",
    namedSchemaNodes(before)
  );
  return isRecord(merged) ? merged : before;
}

/** An array whose entries are functions: a hook list. */
function isFunctionList(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.some(item => typeof item === "function");
}

/** A plain object that is not an array: an entity, a field, a settings block. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return isContainer(value) && !Array.isArray(value);
}

/**
 * Where a value sits in the entity: `schema` is the definition itself, where
 * a key named `access` is an access rule; `data` is a value the definition
 * carries for its author, where `access` is ordinary data, such as a JSON
 * default's.
 */
type SchemaPosition = "schema" | "data";

/**
 * The keys whose value is free-form data rather than schema, where a key
 * named `access` is the author's: a field's default, the settings a plugin or
 * the app hangs on an entity or field, a JSON field's schema, a relationship's
 * or upload's static filter query and its sort per collection, and a field's
 * inline styles. Everything
 * else is schema, so a nesting key added later keeps its access rules
 * restored without being listed here: a free-form key missing from this list
 * loses an `access` entry, where a schema key missing from an allowlist would
 * let a transform set an access rule.
 */
const DATA_KEYS: ReadonlySet<string> = new Set([
  "defaultValue",
  "custom",
  "pluginOptions",
  "jsonSchema",
  "filterOptions",
  "sortOptions",
  "style",
]);

/** Marks a field name more than one field of the entity carries. */
const AMBIGUOUS = Symbol("ambiguous");

/**
 * Every named field of an entity's schema, wherever it sits, by name: how a
 * field the transform moved to another group or tab finds what it was. A
 * name two fields share finds neither.
 *
 * Fields only (`isField`): an entity holds other named records, such as its
 * indexes, and one named like a field made that field ambiguous, so a field
 * moved beside such an index lost its access rule.
 */
type NamedNodes = ReadonlyMap<
  string,
  Record<string, unknown> | typeof AMBIGUOUS
>;

function namedSchemaNodes(value: unknown): NamedNodes {
  const into = new Map<string, Record<string, unknown> | typeof AMBIGUOUS>();
  collectNamed(value, into);
  return into;
}

/** Adds the named fields under `value` to `into`. */
function collectNamed(
  value: unknown,
  into: Map<string, Record<string, unknown> | typeof AMBIGUOUS>
): void {
  for (const child of schemaChildren(value)) {
    if (Array.isArray(value) && isField(child)) {
      into.set(child.name, into.has(child.name) ? AMBIGUOUS : child);
    }
    collectNamed(child, into);
  }
}

/**
 * A field: a named record with a type, core's or a plugin's. An index entry
 * (`{ name, fields, unique }`) has a name and no type, and so does any other
 * named record that is not a field.
 */
function isField(
  value: unknown
): value is Record<string, unknown> & { name: string; type: string } {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.type === "string"
  );
}

/**
 * The values directly under `value` that are schema: an array's elements, and
 * a record's values outside the data keys. A plugin field's are its data.
 */
function schemaChildren(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value) || isPluginField(value)) return [];
  return Object.entries(value)
    .filter(([key]) => !DATA_KEYS.has(key))
    .map(([, child]) => child);
}

/** The field types core defines; any other a field names is a plugin's. */
const CORE_FIELD_TYPES: ReadonlySet<string> = new Set(ALL_FIELD_TYPES);

/**
 * A field whose type a plugin contributes. It may carry options of its own
 * directly on the field (`PluginFieldInput`), whose content is the plugin's
 * data, so only the field's own `access` is an access rule there.
 */
function isPluginField(value: Record<string, unknown>): boolean {
  return isField(value) && !CORE_FIELD_TYPES.has(value.type);
}

function mergeBehaviour(
  before: unknown,
  after: unknown,
  at: SchemaPosition,
  named: NamedNodes
): unknown {
  const decided = behaviourVerdict(before, after);
  if (decided !== UNDECIDED) return decided;
  if (Array.isArray(after)) return mergeArray(before, after, at, named);
  if (!isContainer(after)) return after;
  return mergeRecord(isRecord(before) ? before : {}, after, at, named);
}

/** `behaviourVerdict` found no behaviour to decide on: the values merge. */
const UNDECIDED = Symbol("undecided");

/**
 * What a position holding behaviour becomes, decided whole: a function, a
 * hook list, or a value of another kind put where `before` held behaviour
 * all keep `before`'s (or drop what `after` added). `UNDECIDED` when neither
 * side holds behaviour there, and the two merge element by element.
 */
function behaviourVerdict(before: unknown, after: unknown): unknown {
  if (typeof after === "function") {
    return typeof before === "function" ? before : DROP;
  }
  if (isFunctionList(after) || isFunctionList(before)) {
    return isFunctionList(before) ? before : DROP;
  }
  if (replacesBehaviourWhole(before, after)) return before;
  return UNDECIDED;
}

/** A function, an array, a plain object, or any other value. */
function kindOf(value: unknown): "function" | "array" | "record" | "value" {
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "array";
  return isRecord(value) ? "record" : "value";
}

/**
 * Whether `after` is a value of another kind put where `before` held
 * behaviour: a function default replaced by a constant, a components map by
 * a string, a list of field objects by a map. Nothing in `after` pairs with
 * what `before` held, so merging the two would keep none of it; `before` is
 * kept whole instead.
 */
function replacesBehaviourWhole(before: unknown, after: unknown): boolean {
  return kindOf(before) !== kindOf(after) && holdsFunction(before);
}

/** `after`'s elements, each merged with the one it replaced in `before`. */
function mergeArray(
  before: unknown,
  after: readonly unknown[],
  at: SchemaPosition,
  named: NamedNodes
): unknown[] {
  const previous = Array.isArray(before) ? before : [];
  return after
    .map((item, index) =>
      mergeBehaviour(
        counterpart(previous, item, index, at, named),
        item,
        at,
        named
      )
    )
    .filter(item => item !== DROP);
}

/**
 * `after`'s keys merged with `previous`'s. In the schema, `access` is taken
 * from `previous`; in data it merges like any other key.
 */
function mergeRecord(
  previous: Record<string, unknown>,
  after: Record<string, unknown>,
  at: SchemaPosition,
  named: NamedNodes
): Record<string, unknown> {
  const rules = at === "schema";
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (rules && key === "access") continue;
    const child = positionUnder(after, key, at);
    const merged = mergeBehaviour(previous[key], value, child, named);
    if (merged !== DROP) out[key] = merged;
  }
  if (rules && previous.access !== undefined) out.access = previous.access;
  restoreRemovedBehaviour(previous, out);
  return out;
}

/**
 * Where the value under `key` of `record`, itself at `at`, sits: schema below
 * schema, except under a data key and anywhere under a plugin field, whose
 * options are its own data.
 */
function positionUnder(
  record: Record<string, unknown>,
  key: string,
  at: SchemaPosition
): SchemaPosition {
  if (at !== "schema" || DATA_KEYS.has(key) || isPluginField(record)) {
    return "data";
  }
  return "schema";
}

/**
 * Put back what the transform removed or blanked when it carried behaviour:
 * the entity keeps it. A value without a function is structure, and its
 * removal stands.
 */
function restoreRemovedBehaviour(
  previous: Record<string, unknown>,
  out: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(previous)) {
    if ((out[key] === undefined || out[key] === null) && holdsFunction(value)) {
      out[key] = value;
    }
  }
}

/**
 * The element of `previous` that `item` replaced, or undefined for one it
 * added. By `name`, among its siblings and then, in the schema, anywhere in
 * the entity (`namedSchemaNodes`); in the schema, an element without one by
 * `slug`, and
 * then by the field names it holds: a tab or row has no name, and paired by
 * position, a tab inserted before it would make its fields read as new and
 * their access rules as added, and so stripped. By position otherwise.
 */
function counterpart(
  previous: readonly unknown[],
  item: unknown,
  index: number,
  at: SchemaPosition,
  named: NamedNodes
): unknown {
  if (!isRecord(item)) return previous[index];
  if (typeof item.name === "string") {
    const sibling = previous.find(
      candidate => isRecord(candidate) && candidate.name === item.name
    );
    if (sibling !== undefined || at !== "schema") return sibling;
    // Moved from another group or tab: found by name in the whole entity.
    const moved = named.get(item.name);
    return moved === AMBIGUOUS ? undefined : moved;
  }
  if (at !== "schema") return previous[index];
  if (typeof item.slug === "string") {
    return previous.find(
      candidate => isRecord(candidate) && candidate.slug === item.slug
    );
  }
  const held = fieldNamesIn(item);
  if (held.size === 0) return previous[index];
  return sharingMostNames(previous, held);
}

/** The names of the fields nested in `value` (`namedSchemaNodes`). */
function fieldNamesIn(value: unknown): ReadonlySet<string> {
  return new Set(namedSchemaNodes(value).keys());
}

/** The element of `previous` holding the most of `names`, if any holds one. */
function sharingMostNames(
  previous: readonly unknown[],
  names: ReadonlySet<string>
): unknown {
  let best: unknown;
  let most = 0;
  for (const candidate of previous) {
    const shared = [...fieldNamesIn(candidate)].filter(name =>
      names.has(name)
    ).length;
    if (shared > most) {
      best = candidate;
      most = shared;
    }
  }
  return best;
}
