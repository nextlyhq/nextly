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

import type { BlocksFieldDescriptor } from "./class-usage-subjects";
import { isBlocksField } from "./fields/blocksHelper";

/**
 * A bound on how many field declarations one collection can contribute.
 *
 * Groups nest and the shape is author-supplied, so a pathological depth or
 * breadth would otherwise spin here. Sized so that reaching it means the
 * configuration is wrong rather than large, and deliberately meaningless about
 * how many fields a real collection has. It is a backstop rather than the cycle
 * defence: a cycle is broken by identity below, because a bound alone ends the
 * walk without ever reaching the fields the cycle is hiding.
 */
const MAX_FIELDS_VISITED = 10_000;

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
  const fields = collection?.fields;
  if (!Array.isArray(fields)) return [];
  const collectionLocalized = collection?.localized === true;

  const found: BlocksFieldDescriptor[] = [];
  const seen = new Set<string>();
  // Groups already expanded, by IDENTITY. A group that lists itself would
  // otherwise be pushed back to the front of the queue every iteration, and the
  // siblings behind it would never be reached — the walk would end at the bound
  // having silently returned nothing, which is indistinguishable from a
  // collection that declares no blocks field.
  const expanded = new WeakSet<object>();

  // Depth-first over a stack rather than recursion: the nesting is
  // author-supplied, and a cycle must not take the process with it.
  const pending: unknown[] = [...fields];
  let visited = 0;

  while (pending.length > 0 && visited < MAX_FIELDS_VISITED) {
    visited += 1;
    const field = pending.shift();

    const children = presentationalChildren(field);
    if (children !== null) {
      const group = field as object;
      if (expanded.has(group)) continue;
      expanded.add(group);
      pending.unshift(...children);
      continue;
    }

    const descriptor = readBlocksField(field, collectionLocalized);
    if (descriptor === null) continue;
    // A duplicate name is one subject, not two. Enumerating it twice would
    // reconcile the same rows twice in one pass, and the second pass reads the
    // first one's inserts as rows the document no longer justifies.
    if (seen.has(descriptor.name)) continue;
    seen.add(descriptor.name);
    found.push(descriptor);
  }

  return found;
}
