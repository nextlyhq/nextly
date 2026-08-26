/**
 * Which fields on a collection this index is responsible for.
 *
 * The write path registers ONE hook for every collection, so most calls reach
 * it with nothing to do. This is the filter, and it reads the collection's LIVE
 * configuration rather than a list captured when the plugin was wired: a
 * collection can be created, and a field added to one, after that moment.
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
 * Only TOP-LEVEL fields are read. A blocks field nested inside a group or a
 * repeater is not indexed, and that is deliberate rather than pending: the
 * rebuild reads `item[field]` and cannot resolve a nested path either, so
 * indexing one here would create rows that no rebuild could ever reconcile or
 * sweep. The two halves have to agree about what a subject is, and the cheapest
 * way to keep them agreeing is for both to look in the same place. Widening
 * them is one change, not two.
 *
 * @module class-usage-blocks-fields
 */
import type { BlocksFieldDescriptor } from "./class-usage-subjects";
import { isBlocksField } from "./fields/blocksHelper";

/**
 * A bound on how many field declarations one collection can contribute.
 *
 * Presentational groups nest, and the shape is author-supplied, so a cycle or a
 * pathological depth would otherwise spin here. Sized so that reaching it means
 * the configuration is wrong rather than large, and deliberately meaningless
 * about how many fields a real collection has.
 */
const MAX_FIELDS_VISITED = 10_000;

/**
 * The children a NAMELESS group contributes to THIS level.
 *
 * A group without a `name` is presentational: it groups fields in the admin and
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
  const field = value as { type?: unknown; name?: unknown; fields?: unknown };
  if (field.type !== "group") return null;
  // A name is what makes a group store its own object. Absent, it is transparent.
  if (field.name !== undefined) return null;
  return Array.isArray(field.fields) ? field.fields : null;
}

/** Whether a configured field is one this index tracks. */
function readBlocksField(value: unknown): BlocksFieldDescriptor | null {
  if (typeof value !== "object" || value === null) return null;
  const field = value as {
    type?: unknown;
    name?: unknown;
    localized?: unknown;
  };
  // The canonical guard rather than a second comparison against the type
  // string. It answers this same question for every heterogeneous schema walk
  // in this package, and two implementations of one question drift silently.
  if (!isBlocksField(field)) return null;
  // A name is what the `field` column of every row holds, so a field without a
  // usable one has no addressable subject at all.
  if (typeof field.name !== "string" || field.name.length === 0) return null;
  return {
    name: field.name,
    // Absent means not localized, which is the default the schema applies. Read
    // as a strict boolean rather than for truthiness so a stored `"false"` — a
    // string, which a JSON payload can carry — does not read as localized and
    // file one document's classes under every language.
    localized: field.localized === true,
  };
}

/**
 * Every blocks field declared on a collection, in declaration order.
 *
 * Returns an empty list for the collections this index does not track, which is
 * most of them. That makes the filter a property of this function rather than a
 * branch every caller has to remember — and a caller that forgets a branch
 * indexes nothing silently, which is the failure that looks like the feature
 * being off.
 */
export function blocksFieldsOf(
  fields: readonly unknown[] | undefined
): BlocksFieldDescriptor[] {
  if (!Array.isArray(fields)) return [];

  const found: BlocksFieldDescriptor[] = [];
  const seen = new Set<string>();

  // Depth-first over a stack rather than recursion: the nesting is
  // author-supplied, and a cycle must not take the process with it.
  const pending: unknown[] = [...fields];
  let visited = 0;

  while (pending.length > 0 && visited < MAX_FIELDS_VISITED) {
    visited += 1;
    const field = pending.shift();

    const children = presentationalChildren(field);
    if (children !== null) {
      pending.unshift(...children);
      continue;
    }

    const descriptor = readBlocksField(field);
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
