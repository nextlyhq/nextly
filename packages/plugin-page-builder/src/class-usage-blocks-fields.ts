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
import { isFieldGroupFieldType } from "nextly/field-group-type";

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
  const fields = collection?.fields;
  if (!Array.isArray(fields)) return { addressable: [], unaddressable: false };
  return walkDeclarations(fields, collection?.localized === true);
}

/**
 * The walk itself, over a field list already known to be one.
 *
 * Split from the shape guards above so this function is about the traversal —
 * the cursor stack, the cycle set and the two accumulators — and nothing else.
 */
function walkDeclarations(
  fields: readonly unknown[],
  collectionLocalized: boolean
): BlocksFieldSurvey {
  let unaddressable = false;
  const found: BlocksFieldDescriptor[] = [];
  const seen = new Set<string>();
  // Groups already expanded, by IDENTITY. This is what makes the walk finite,
  // and it is the ONLY thing that does: a group listing itself would otherwise
  // be re-entered forever. Expanding each group once bounds the visits at the
  // number of declarations the configuration actually contains.
  //
  // There is no visit cap beside it, deliberately. A cap terminates a cyclic
  // walk without ever reaching the fields the cycle hides, and on a merely LONG
  // list it stops partway and returns fewer descriptors while reporting
  // nothing — so the document's classes go unindexed and read as unused, which
  // is the state that licences deleting a class a page still renders. Nothing
  // validates a field count, so a long list is legal configuration rather than
  // a signal that the config is wrong.
  const expanded = new WeakSet<object>();

  // Depth-first over a stack of CURSORS rather than recursion or a queue of
  // fields. Recursion would let author-supplied nesting exhaust the call stack.
  // A queue would have to move a group's children into it, and a list long
  // enough makes that move throw before any bound can apply — passing them as
  // arguments reaches the engine's argument limit. This runs after the document
  // has committed, where a throw reports a failed save for one that succeeded.
  // A cursor holds each list where it is and reads one field at a time, so no
  // length is ever material.
  // `addressable` travels with the frame: a nested container's children are
  // walked only to NOTICE a blocks field there, never to enumerate one.
  const stack: {
    fields: readonly unknown[];
    index: number;
    addressable: boolean;
  }[] = [{ fields, index: 0, addressable: true }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined || frame.index >= frame.fields.length) {
      stack.pop();
      continue;
    }
    const field = frame.fields[frame.index];
    frame.index += 1;

    const step = stepFor(field, frame.addressable, collectionLocalized);
    if (step.kind === "skip") continue;
    if (step.kind === "unresolved") {
      unaddressable = true;
      continue;
    }
    if (step.kind === "descend") {
      // Each container expanded ONCE, by identity — the only thing making a walk
      // over author-supplied nesting finite, since a group may list itself.
      descend(stack, field as object, step, expanded);
      continue;
    }
    if (!step.addressable) {
      // Found, and unreachable. Recorded as a fact about the collection rather
      // than as a descriptor: enumerating a scope for it would file rows no
      // rebuild can reconcile and no sweep can clear.
      unaddressable = true;
      continue;
    }
    // A duplicate name is one subject, not two. Enumerating it twice would
    // reconcile the same rows twice in one pass, and the second pass reads the
    // first one's inserts as rows the document no longer justifies.
    if (seen.has(step.descriptor.name)) continue;
    seen.add(step.descriptor.name);
    found.push(step.descriptor);
  }

  return { addressable: found, unaddressable };
}

/**
 * Push a container's children onto the cursor stack, once per container.
 *
 * Kept out of the walk so the loop reads as a dispatch over the three things a
 * declaration can be. A container already expanded is left alone; the walk moves
 * on either way, which is why this answers nothing.
 */
function descend(
  stack: { fields: readonly unknown[]; index: number; addressable: boolean }[],
  container: object,
  step: { fields: readonly unknown[]; addressable: boolean },
  expanded: WeakSet<object>
): void {
  if (expanded.has(container)) return;
  expanded.add(container);
  stack.push({ fields: step.fields, index: 0, addressable: step.addressable });
}

/** What the walk does with one declaration. */
type FieldStep =
  | {
      kind: "descend";
      fields: readonly unknown[];
      /** Whether a blocks field found below can be enumerated. */
      addressable: boolean;
    }
  | { kind: "field"; descriptor: BlocksFieldDescriptor; addressable: boolean }
  /** A reference whose definition this cannot read, so it may hide a blocks field. */
  | { kind: "unresolved" }
  | { kind: "skip" };

/**
 * Which of the three a declaration is, decided in one place.
 *
 * Kept out of the walk so the loop is about the stack and the accumulators. The
 * two descents are different answers to one question and belong beside each
 * other: a PRESENTATIONAL group's children live at the parent path and keep the
 * frame's addressability, while any OTHER container nests its children under its
 * own key — those are walked only so a blocks field inside one is NOTICED, never
 * to enumerate it.
 */
function stepFor(
  field: unknown,
  addressable: boolean,
  collectionLocalized: boolean
): FieldStep {
  const children = presentationalChildren(field);
  if (children !== null) {
    return { kind: "descend", fields: children, addressable };
  }

  const nested = nestedDeclarations(field);
  if (nested !== null) {
    return { kind: "descend", fields: nested, addressable: false };
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
  if (isFieldGroupFieldType((field as { type?: unknown } | null)?.type)) {
    return { kind: "unresolved" };
  }

  const descriptor = readBlocksField(field, collectionLocalized);
  return descriptor === null
    ? { kind: "skip" }
    : { kind: "field", descriptor, addressable };
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
