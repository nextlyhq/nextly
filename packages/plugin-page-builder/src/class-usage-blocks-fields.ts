/**
 * Which fields on a collection this index is responsible for.
 *
 * The write path registers ONE hook for every collection, so most calls reach
 * it with nothing to do. This is the filter, and it reads the collection's LIVE
 * configuration rather than a list captured when the plugin was wired: a
 * collection can be created, and a field added to one, after that moment.
 *
 * ## Why it takes the collection rather than its fields
 *
 * Whether a field stores per language is decided by the field's flag AND the
 * collection's master switch together, so the two have to arrive from the same
 * collection. Separate parameters let a caller pair one collection's fields
 * with another's switch, and the result would be subjects under locales that
 * collection never stores.
 *
 * ## Why it reads unvalidated
 *
 * Configuration reaches a hook as whatever the host wrote, including from
 * untyped JavaScript and from the Schema Builder's stored payloads. A field
 * missing a name, or carrying a non-string one, is skipped rather than
 * defaulted: a subject keyed by an empty field name would collect rows from
 * every unnamed field on the collection into one bucket, and the reconciler
 * would then delete each field's rows on behalf of the others.
 *
 * ## The limit, stated because it has to match the rebuild
 *
 * Only fields addressable at the TOP LEVEL are read. A blocks field nested
 * inside a named group or a repeater is not indexed, and that is deliberate
 * rather than pending: the rebuild reads `item[field]` and cannot resolve a
 * nested path either, so indexing one here would create rows that no rebuild
 * could ever reconcile or sweep. The two halves have to agree about what a
 * subject is, and the cheapest way to keep them agreeing is for both to look in
 * the same place. Widening them is one change, not two.
 *
 * @module class-usage-blocks-fields
 */
import { isFieldLocalized } from "nextly/config";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "nextly/field-group-type";

import type { BlocksFieldDescriptor } from "./class-usage-subjects";
import { isBlocksField } from "./fields/blocksHelper";

/**
 * The name a field is addressed by, or null when it has none usable.
 *
 * One definition, because two questions depend on it and they must not answer
 * differently about the same field: whether a group is presentational, and
 * whether a blocks field has an addressable subject. A group treated as named
 * while its blocks child is treated as unaddressable would drop that child
 * silently at both steps.
 *
 * An empty string is NOT a name. It is what a host writes for a layout group it
 * gave no key, and the field's values then live at the parent level — which is
 * how core resolves references and redacts paths through such a group, so
 * reading it as a name here would disagree with where the values actually are.
 */
function fieldName(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const name = (value as { name?: unknown }).name;
  if (typeof name !== "string" || name.length === 0) return null;
  return name;
}

/**
 * The children a NAMELESS group contributes to THIS level.
 *
 * A group without a name is presentational: it groups fields in the admin and
 * stores nothing of its own, so its children live at the parent path. A blocks
 * field inside one is reachable as `item[field]` exactly like a top-level
 * declaration — so skipping it leaves that document's classes out of the index
 * entirely, and a class it still renders reads as unused and can be deleted.
 *
 * A NAMED group is the opposite and stays excluded: it nests its data under its
 * own key, so a child is reachable only through a path neither this nor the
 * rebuild resolves. Same for a repeater, whose children are per-row. Descending
 * into those would file rows no rebuild could reconcile or sweep.
 */
function presentationalChildren(value: unknown): readonly unknown[] | null {
  if (typeof value !== "object" || value === null) return null;
  const field = value as { type?: unknown; fields?: unknown };
  if (field.type !== "group") return null;
  if (fieldName(value) !== null) return null;
  return Array.isArray(field.fields) ? field.fields : null;
}

/**
 * Whether a configured field is one this index tracks.
 *
 * `collectionLocalized` is the collection's master switch, and the classifier
 * folds it in: a field flagged localized on a collection that stores no
 * translations is stored ONCE, under the empty locale key. Reading the flag
 * alone would enumerate a subject per configured language for it and leave the
 * one subject a read resolves to holding no rows at all.
 */
function readBlocksField(
  value: unknown,
  collectionLocalized: boolean
): BlocksFieldDescriptor | null {
  if (typeof value !== "object" || value === null) return null;
  const field = value as { type?: unknown; localized?: unknown };
  // The canonical guard rather than a second comparison against the type
  // string. It answers this same question for every heterogeneous schema walk
  // in this package, and two implementations of one question drift silently.
  if (!isBlocksField(field)) return null;
  // A name is what the `field` column of every row holds, so a field without a
  // usable one has no addressable subject at all.
  const name = fieldName(value);
  if (name === null) return null;
  return {
    name,
    // The classifier core stores by, so this cannot disagree with where the
    // values are. It reads `localized` only when it is a strict boolean, so a
    // stored `"false"` — a string, which a JSON payload can carry — does not
    // read as localized and file one document's classes under every language.
    localized: isFieldLocalized(
      {
        type: field.type,
        name,
        localized:
          typeof field.localized === "boolean" ? field.localized : undefined,
      },
      collectionLocalized
    ),
  };
}

/** The collection configuration this filter reads, as the host wrote it. */
export interface BlocksFieldsCollection {
  /** Top-level field declarations, in their authored form. */
  fields?: unknown;
  /** The collection's localization master switch. */
  localized?: unknown;
}

/**
 * Every blocks field a collection stores at its top level, in declaration
 * order.
 *
 * Returns an empty list for the collections this index does not track, which is
 * most of them. That makes the filter a property of this function rather than a
 * branch every caller has to remember — and a caller that forgets a branch
 * indexes nothing silently, which is the failure that looks like the feature
 * being off.
 */
export function blocksFieldsOf(
  collection: BlocksFieldsCollection | null | undefined
): BlocksFieldDescriptor[] {
  return blocksFieldSurvey(collection).addressable;
}

/** What one collection declares, split by whether this index can address it. */
export interface BlocksFieldSurvey {
  /** The fields a scope can be enumerated for, in declaration order. */
  addressable: BlocksFieldDescriptor[];
  /**
   * Whether the collection ALSO declares a blocks field this cannot address.
   *
   * A blocks field nested under a named group — or any other container that
   * stores its children under its own key — has no subject the row model can
   * name, so no scope is enumerated for it and no hook reconciles it. That is
   * deliberate, and on its own it is a gap the completeness flag has to know
   * about: a collection whose only blocks field is nested contributes no scope,
   * so "every scope walked" is vacuously true and health reports an index that
   * never saw those references as exact. A count of zero reported as exact is
   * what licenses deleting a component those documents still render.
   *
   * Reported from the SAME traversal that collects the addressable ones, rather
   * than by a second walk: two walks over one configuration agree on the day
   * they are written, and the one that drifts here fails by staying silent.
   */
  unaddressable: boolean;
}

/**
 * Every blocks field a collection declares, told apart by addressability.
 *
 * {@link blocksFieldsOf} is the narrow view of this, derived from it rather than
 * computed beside it.
 */
export function blocksFieldSurvey(
  collection: BlocksFieldsCollection | null | undefined
): BlocksFieldSurvey {
  const reach = blocksFieldReach(collection);
  return {
    addressable: reach.fields
      .filter(field => field.path.length === 1)
      .map(field => field.descriptor),
    unaddressable:
      reach.unreachable || reach.fields.some(field => field.path.length > 1),
  };
}

/** One blocks field a collection declares, and where its value is stored. */
export interface ReachedBlocksField {
  /** The field, named by its own key, and whether it stores per language. */
  readonly descriptor: BlocksFieldDescriptor;
  /**
   * The keys leading to its value in a stored row: `["content"]` for a field at
   * the top level (or inside a nameless group), `["hero", "body"]` for one
   * inside the named group `hero`.
   */
  readonly path: readonly string[];
}

/** Every blocks field a collection declares, reached through named groups. */
export interface BlocksFieldReach {
  /** The fields whose value a row holds at a fixed path, in declaration order. */
  readonly fields: readonly ReachedBlocksField[];
  /**
   * Whether the collection also declares a blocks field with no fixed path: one
   * in a repeater, whose values are per row, or behind a reference this cannot
   * resolve. A reader deciding whether a component is still used treats that
   * as a possible use.
   */
  readonly unreachable: boolean;
}

/**
 * Every blocks field a collection declares, at the path its value is stored
 * under, named groups included.
 *
 * The richer view {@link blocksFieldSurvey} is derived from: the usage index
 * addresses only the top-level fields, and a rewrite of every host reads the
 * ones under named groups too.
 */
export function blocksFieldReach(
  collection: BlocksFieldsCollection | null | undefined,
  /** How many containers the walk may expand; see {@link MAX_EXPANSIONS}. */
  maxExpansions: number = MAX_EXPANSIONS,
  /**
   * The field groups whose definitions the site declares, by slug. Given, a
   * field group a declaration references is read through its definition;
   * absent, or for a group it does not declare, the reference is unresolved.
   */
  fieldGroups?: FieldGroupDefinitions
): BlocksFieldReach {
  const fields = collection?.fields;
  if (!Array.isArray(fields)) return { fields: [], unreachable: false };
  return walkDeclarations(
    fields,
    collection?.localized === true,
    maxExpansions,
    fieldGroups
  );
}

/**
 * A field group's definition by its slug, as the site's code declares it, or
 * `undefined` for one it does not (made in the admin, which no plugin surface
 * lists).
 */
export type FieldGroupDefinitions = (
  slug: string
) => { readonly fields?: unknown } | undefined;

/**
 * How deep a chain of named groups the walk follows. A group that lists itself
 * makes its path grow without end; past this it is reported as unreachable,
 * which a reader treats as a possible use rather than as none.
 */
const MAX_GROUP_DEPTH = 16;

/**
 * How many containers one walk expands in all. The depth bound alone does not
 * bound the work: a named group holding several named groups that each list
 * it back makes a new path on every branch, so the paths below the depth
 * bound grow exponentially with the branching. Past this many expansions the
 * walk stops expanding and reports the rest as unreachable, which a reader
 * treats as a possible use. Far above what a real configuration declares.
 */
const MAX_EXPANSIONS = 10_000;

/** Where a frame of the walk is: the path so far, and whether it is fixed. */
type WalkMode = "fixed" | "hidden";

/** One list of declarations being read, and where its values live. */
interface WalkFrame {
  fields: readonly unknown[];
  index: number;
  mode: WalkMode;
  /** The named groups above this list, outermost first. */
  path: readonly string[];
}

/**
 * The walk itself, over a field list already known to be one.
 *
 * Split from the shape guards above so this function is about the traversal —
 * the cursor stack, the cycle set and the two accumulators — and nothing else.
 */
function walkDeclarations(
  fields: readonly unknown[],
  collectionLocalized: boolean,
  maxExpansions: number,
  fieldGroups: FieldGroupDefinitions | undefined
): BlocksFieldReach {
  let unreachable = false;
  const found: ReachedBlocksField[] = [];
  const seen = new Set<string>();
  // Groups already expanded, by identity AND by whether reaching them that way
  // makes what is inside addressable. This is what makes the walk finite,
  // and it is the ONLY thing that does: a group listing itself would otherwise
  // be re-entered forever. Expanding each group once per place bounds the
  // visits, with a chain of NAMED groups followed only to MAX_GROUP_DEPTH
  // because each level is a new place.
  //
  // There is no visit cap beside it, deliberately. A cap terminates a cyclic
  // walk without ever reaching the fields the cycle hides, and on a merely LONG
  // list it stops partway and returns fewer descriptors while reporting
  // nothing — so the document's classes go unindexed and read as unused, which
  // is the state that licences deleting a class a page still renders. Nothing
  // validates a field count, so a long list is legal configuration rather than
  // a signal that the config is wrong.
  // Keyed by the container AND by the path and mode it was reached under: one
  // declaration object can appear in two places, and the two store their data
  // under different keys, so each place is a different reach.
  const expanded = new WeakMap<object, Set<string>>();

  // Depth-first over a stack of CURSORS rather than recursion or a queue of
  // fields. Recursion would let author-supplied nesting exhaust the call stack.
  // A queue would have to move a group's children into it, and a list long
  // enough makes that move throw before any bound can apply — passing them as
  // arguments reaches the engine's argument limit. This runs after the document
  // has committed, where a throw reports a failed save for one that succeeded.
  // A cursor holds each list where it is and reads one field at a time, so no
  // length is ever material.
  // The mode and path travel with the frame: a named group's children are
  // reached at a fixed path beneath it, and a repeater's children are walked
  // only to NOTICE a blocks field there, never to reach one.
  const stack: WalkFrame[] = [{ fields, index: 0, mode: "fixed", path: [] }];
  const budget = { left: maxExpansions };

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined || frame.index >= frame.fields.length) {
      stack.pop();
      continue;
    }
    const field = frame.fields[frame.index];
    frame.index += 1;

    const step = stepFor(field, frame, collectionLocalized, fieldGroups);
    const state = { stack, expanded, seen, found, budget };
    if (!takeStep(step, field, frame, state)) {
      unreachable = true;
    }
  }

  return { fields: found, unreachable };
}

/** What the walk accumulates, handed to each step. */
interface WalkState {
  readonly stack: WalkFrame[];
  readonly expanded: WeakMap<object, Set<string>>;
  readonly seen: Set<string>;
  readonly found: ReachedBlocksField[];
  /** The expansions this walk may still make; see {@link MAX_EXPANSIONS}. */
  readonly budget: { left: number };
}

/**
 * Act on one declaration's step. Answers false when the declaration may hold
 * a blocks field the walk cannot reach, which the walk reports as unreachable.
 */
function takeStep(
  step: FieldStep,
  field: unknown,
  frame: WalkFrame,
  state: WalkState
): boolean {
  if (step.kind === "skip") return true;
  if (step.kind === "unresolved") return false;
  if (step.kind === "groups") {
    // Each referenced definition's fields, walked where no fixed path
    // reaches them: a field group's values are stored apart from the row, so
    // a blocks field inside one is noticed, as unreachable, never reached.
    for (const definition of step.definitions) {
      if (frame.path.length >= MAX_GROUP_DEPTH) return false;
      if (state.budget.left <= 0) return false;
      state.budget.left -= 1;
      descend(
        state.stack,
        definition,
        { mode: "hidden", path: [...frame.path, "\u0000group"] },
        state.expanded
      );
    }
    return true;
  }
  if (step.kind === "descend") {
    // Each container expanded once per place it is reached from, and a chain
    // of named groups followed only so deep — together the only things making
    // a walk over author-supplied nesting finite, since a group may list
    // itself.
    if (step.frame.path.length > MAX_GROUP_DEPTH) return false;
    if (state.budget.left <= 0) return false;
    state.budget.left -= 1;
    descend(state.stack, field as object, step.frame, state.expanded);
    return true;
  }
  // Found, with no fixed path to it. Recorded as a fact about the collection:
  // enumerating a scope for it would file rows no rebuild can reconcile and no
  // sweep can clear.
  if (frame.mode === "hidden") return false;
  // A duplicate path is one subject, not two. Enumerating it twice would
  // reconcile the same rows twice in one pass, and the second pass reads the
  // first one's inserts as rows the document no longer justifies.
  const path = [...frame.path, step.descriptor.name];
  const key = path.join("\u001F");
  if (!state.seen.has(key)) {
    state.seen.add(key);
    state.found.push({ descriptor: step.descriptor, path });
  }
  return true;
}

/**
 * Push a container's children onto the cursor stack, once per place it is
 * reached from.
 *
 * Kept out of the walk so the loop reads as a dispatch over the things a
 * declaration can be. A container already expanded from this place is left
 * alone; the walk moves on either way, which is why this answers nothing.
 */
function descend(
  stack: WalkFrame[],
  container: object,
  next: Omit<WalkFrame, "fields" | "index">,
  expanded: WeakMap<object, Set<string>>
): void {
  // Keyed by the container AND by what reaching it this way means. One
  // declaration object can appear twice in a configuration — a shared nameless
  // group at the top level and again beneath a named one — and the two
  // occurrences store their data under DIFFERENT keys, so the blocks field
  // inside is reached at one path through one and at another (or not at all)
  // through the other. Keyed by identity alone, the first visit claimed the
  // object and the second was skipped silently.
  const place = `${next.mode}\u001F${next.path.join("\u001F")}`;
  const places = expanded.get(container) ?? new Set<string>();
  if (places.has(place)) return;
  places.add(place);
  expanded.set(container, places);
  stack.push({ ...next, fields: fieldsOf(container), index: 0 });
}

/** The declarations a container lists; the walk only descends into lists. */
function fieldsOf(container: object): readonly unknown[] {
  const listed = (container as { fields?: unknown }).fields;
  return Array.isArray(listed) ? listed : [];
}

/** What the walk does with one declaration. */
type FieldStep =
  | {
      kind: "descend";
      /** Where the container's children are, and whether at a fixed path. */
      frame: Omit<WalkFrame, "fields" | "index">;
    }
  | { kind: "field"; descriptor: BlocksFieldDescriptor }
  /** A reference whose definition this cannot read, so it may hide a blocks field. */
  | { kind: "unresolved" }
  /** A reference to field groups the site declares: their definitions. */
  | { kind: "groups"; definitions: readonly object[] }
  | { kind: "skip" };

/**
 * Which of the things a declaration is, decided in one place.
 *
 * Kept out of the walk so the loop is about the stack and the accumulators. The
 * three descents are different answers to one question and belong beside each
 * other: a PRESENTATIONAL group's children live at the parent path; a NAMED
 * group's children live beneath its key, at a fixed path; and any OTHER
 * container (a repeater) stores its children per row — those are walked only
 * so a blocks field inside one is NOTICED, never to reach it.
 */
function stepFor(
  field: unknown,
  frame: Pick<WalkFrame, "mode" | "path">,
  collectionLocalized: boolean,
  fieldGroups: FieldGroupDefinitions | undefined
): FieldStep {
  if (presentationalChildren(field) !== null) {
    return { kind: "descend", frame: { mode: frame.mode, path: frame.path } };
  }

  if (nestedDeclarations(field) !== null) {
    const group = namedGroupKey(field);
    return {
      kind: "descend",
      frame:
        group !== null && frame.mode === "fixed"
          ? { mode: "fixed", path: [...frame.path, group] }
          : { mode: "hidden", path: frame.path },
    };
  }

  // A REFERENCE to a definition stored elsewhere. A `fieldGroup` or `component`
  // field carries only the slug it points at, so there is no inline `fields`
  // array to descend into and a blocks field inside that definition is invisible
  // here — reported as neither a scope nor unreachable, which is the vacuous
  // completeness this survey exists to stop.
  //
  // Resolving it is not available: the plugin context publishes collections,
  // singles, users, media, email, versions and jobs, and no field-group
  // registry. So an unresolved reference is treated as possibly holding blocks.
  //
  // That is the fail-closed direction and it has a real cost: a site using any
  // field group never reports an exact count, so a delete stays conservative for
  // ever. The other direction permits deleting a component the referenced group
  // still renders, which is the outcome this index exists to prevent.
  //
  // Enumerated rather than structural, deliberately — through the canonical
  // predicate rather than a second list of the two names. There is no property
  // that distinguishes a reference from an ordinary scalar field without knowing
  // the vocabulary, and treating every unrecognised type as unresolvable would
  // mark a text field unreachable.
  //
  // Where the site's own declarations are handed in, a reference to a group
  // the site declares in code is read through that definition: a group
  // holding no blocks field holds no copy, and one holding a blocks field is
  // still reported unreachable, since its values are stored apart from the
  // row. A group the site does not declare (made in the admin) stays
  // unresolved.
  if (isFieldGroupFieldType((field as { type?: unknown } | null)?.type)) {
    const definitions =
      fieldGroups === undefined ? undefined : definitionsOf(field, fieldGroups);
    return definitions === undefined
      ? { kind: "unresolved" }
      : { kind: "groups", definitions };
  }

  const descriptor = readBlocksField(field, collectionLocalized);
  return descriptor === null ? { kind: "skip" } : { kind: "field", descriptor };
}

/**
 * The key a NAMED group stores its children under, or null for any other
 * container. A repeater has a name too, but its children are stored per row,
 * so they have no fixed path.
 */
function namedGroupKey(value: unknown): string | null {
  if ((value as { type?: unknown } | null)?.type !== "group") return null;
  return fieldName(value);
}

/**
 * The child declarations of a container this index does not address, or null.
 *
 * The complement of {@link presentationalChildren}: that one names the
 * containers whose children belong to THIS level, and this one names every
 * other container of declarations, so a blocks field nested in one can be
 * noticed without being enumerated.
 */
function nestedDeclarations(value: unknown): readonly unknown[] | null {
  if (typeof value !== "object" || value === null) return null;
  const field = value as { fields?: unknown };
  return Array.isArray(field.fields) ? field.fields : null;
}

/**
 * A Single's declaration, as the usage index reads which of its blocks fields
 * store per language.
 *
 * A Single declared in code states both its switch and each field's flag. One
 * made in the admin states neither on the surface a plugin can read, so on a
 * site with languages each of its fields is read as stored per language: a
 * shared value is then recorded once per language, which counts the Single
 * once all the same, rather than a translation's components being missed.
 */
export function singleUsageDeclaration(single: {
  readonly fields?: unknown;
  readonly localized?: boolean;
  readonly languagesUnknown?: boolean;
}): BlocksFieldsCollection {
  if (single.languagesUnknown !== true) {
    return { fields: single.fields, localized: single.localized === true };
  }
  return { fields: everyFieldLocalized(single.fields, 0), localized: true };
}

/**
 * A list of declarations with every field in it, and in every container it
 * holds, marked as stored per language, so a blocks field inside a nameless
 * group is read per language as a top-level one is. Containers deeper than
 * the declaration walk reads are left as they are; the walk reports those as
 * out of reach anyway.
 */
function everyFieldLocalized(fields: unknown, depth: number): unknown {
  if (!Array.isArray(fields) || depth > MAX_GROUP_DEPTH) return fields;
  return fields.map((field: unknown) => {
    if (typeof field !== "object" || field === null) return field;
    const nested = (field as { fields?: unknown }).fields;
    return {
      ...field,
      localized: true,
      ...(Array.isArray(nested)
        ? { fields: everyFieldLocalized(nested, depth + 1) }
        : {}),
    };
  });
}

/**
 * The definitions of every field group `field` references, each read from the
 * site's declarations; `undefined` when it names none, or one the site does
 * not declare as a list of fields, so the reference stays unresolved.
 */
function definitionsOf(
  field: unknown,
  fieldGroups: FieldGroupDefinitions
): object[] | undefined {
  const { single, many } = extractFieldGroupReferences(field);
  const slugs = [...(single === undefined ? [] : [single]), ...(many ?? [])];
  if (slugs.length === 0) return undefined;
  const definitions: object[] = [];
  for (const slug of slugs) {
    const definition = fieldGroups(slug);
    if (definition === undefined || !Array.isArray(definition.fields)) {
      return undefined;
    }
    definitions.push(definition);
  }
  return definitions;
}
