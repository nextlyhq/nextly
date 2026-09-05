/**
 * Pointing a block's `#fragment` PROPS at wherever those ids ended up.
 *
 * `cssId` is not referenced only by markup. A link's `href` may be `#pricing`,
 * and the renderer accepts that — `core/button` passes a bare fragment through
 * to the DOM. So a copier that mints a fresh `cssId` and stops has moved the
 * target and left the link behind, and the anchor resolves to nothing: the same
 * silent breakage as a dangling `aria-labelledby`, one prop over.
 *
 * ## Why this is a module and not a private helper
 *
 * Two copiers mint DOM ids. Composition inlines a definition into every
 * instance of it; saving a selection copies a run out of a page. The first grew
 * this rule and the second was written without it — the id map was returned,
 * handed back, and dropped — so a saved pattern stored a link to an id that no
 * longer existed anywhere. A warning written beside the places that existed
 * when it was written does not attach itself to the next one, and a rule that
 * only one of two copiers applies is a rule that holds until someone adds a
 * third.
 *
 * ## Why a copier CAN do this, when it cannot rewrite props generally
 *
 * Which prop of a block holds a link is a property of that block's definition,
 * which the format layer cannot read — and that is exactly why this does not
 * ask. A value is rewritten ONLY when the whole string is `#` followed by an id
 * THIS copy minted. Nothing else can produce that: `"#1 bestseller"` names no
 * minted id and is left as written, and so is a fragment addressing something
 * outside the copied subtree, which belongs to the page and must keep working.
 * The rule needs no schema because the map is the evidence.
 *
 * @module fragment-refs
 */
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys, defineEntry, ownEntry } from "./safe-record";

/**
 * How deep a prop tree is searched for fragment links.
 *
 * A bound on work over values a stored document supplied, generous enough that
 * no authored prop shape reaches it.
 */
const MAX_PROP_SCAN_DEPTH = 8;

/**
 * Rewrite every whole-string `#id` in a prop tree that names a minted id.
 *
 * Returns the SAME value when nothing matched, so a copy of an ordinary block
 * allocates nothing and a caller can compare by identity to tell whether the
 * pass changed anything.
 */
export function remapFragmentProps(
  props: unknown,
  domIds: ReadonlyMap<string, string>
): unknown {
  return remapFragments(props, domIds, 0);
}

function remapFragments(
  props: unknown,
  domIds: ReadonlyMap<string, string>,
  depth: number
): unknown {
  if (domIds.size === 0 || depth > MAX_PROP_SCAN_DEPTH) return props;
  if (typeof props === "string") return remapOneFragment(props, domIds);
  if (Array.isArray(props)) return remapFragmentList(props, domIds, depth);
  if (!isPlainRecord(props)) return props;
  return remapFragmentRecord(props, domIds, depth);
}

/** The same, for a record-valued prop. */
function remapFragmentRecord(
  props: Record<string, unknown>,
  domIds: ReadonlyMap<string, string>,
  depth: number
): unknown {
  const keys = boundedOwnKeys(props, MAX_ENVELOPE_ENTRIES);
  if (keys === null) return props;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    const value = ownEntry(props, key);
    const mapped = remapFragments(value, domIds, depth + 1);
    if (mapped !== value) changed = true;
    defineEntry(next, key, mapped);
  }
  return changed ? next : props;
}

/** The same, for an array-valued prop. */
function remapFragmentList(
  items: readonly unknown[],
  domIds: ReadonlyMap<string, string>,
  depth: number
): unknown {
  let changed = false;
  const next = items.map(item => {
    const mapped = remapFragments(item, domIds, depth + 1);
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? next : items;
}

/** One string, rewritten only if it is exactly a fragment this run minted. */
function remapOneFragment(
  value: string,
  domIds: ReadonlyMap<string, string>
): string {
  if (!value.startsWith("#")) return value;
  const target = domIds.get(value.slice(1));
  return target === undefined ? value : `#${target}`;
}
