/**
 * Pointing a block's `#fragment` PROPS at wherever those ids ended up.
 *
 * `cssId` is not referenced only by markup. A link's `href` may be `#pricing`,
 * and the renderer passes a bare fragment through to the DOM, so a copier that
 * mints a fresh `cssId` and stops has moved the target and left the link
 * behind: the anchor resolves to nothing, which is the same silent breakage as
 * a dangling `aria-labelledby`, one prop over.
 *
 * ## Why this is a module and not a private helper
 *
 * Two copiers mint DOM ids. Composition inlines a definition into every
 * instance of it; saving a selection copies a run out of a page. The first grew
 * this rule and the second was written without it — the id map was returned,
 * handed back, and dropped — so a saved pattern stored a link to an id that no
 * longer existed anywhere. A warning written beside the places that existed
 * when it was written does not attach itself to the next one.
 *
 * ## Only a field that HOLDS a target is rewritten
 *
 * Matching a minted id does not prove a string is a reference. `core/heading`
 * declares `text` and `href` as separate props, and an author may legitimately
 * write a heading reading `#pricing` while a sibling in the same run carries
 * `cssId: "pricing"` — rewriting on the value alone turned that heading into
 * `#pricing-<suffix>` and silently changed what the page SAYS, which then
 * travelled into every insertion of the pattern.
 *
 * So the field name decides, and the value only decides whether there is
 * anything to do. {@link FRAGMENT_REFERENCE_PROPS} lists the names, the way
 * `ID_REFERENCE_ATTRIBUTES` lists them for markup — as data, in one place,
 * rather than left to each copier to remember. The engine cannot ask a block
 * what its props MEAN: `PropSchema.type` is an open string, and no registry
 * reaches the layer that copies a tree.
 *
 * The trade-off is deliberate and it is not symmetric. A name this list does
 * not carry leaves a link that no longer jumps — visible, and an author can
 * repair it. Rewriting on the value alone corrupts authored content invisibly
 * and propagates it. Between failing to help and quietly changing meaning, this
 * fails to help.
 *
 * Two further narrowings keep it away from content even within those fields:
 * only a WHOLE string of `#` followed by an id THIS copy minted is rewritten,
 * so `"#1 bestseller"` in an `href` is left alone, and so is a fragment
 * addressing something outside the copied run — that target belongs to the page
 * and must keep working.
 *
 * @module fragment-refs
 */
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys, defineEntry, ownEntry } from "./safe-record";

/**
 * Prop names whose STRING value is a link target.
 *
 * Published as data for the same reason `ID_REFERENCE_ATTRIBUTES` is: a surface
 * that copies nodes without going through this helper still has to know which
 * fields carry a target, and a block adding a differently-named one belongs
 * here rather than in a second copy of the rule.
 *
 * `href` and `url` are the two the shipped blocks use — `href` on the link and
 * button blocks, `url` on a rich-text link node and on a serialized button.
 * `src` is deliberately absent: it addresses media, where a bare fragment means
 * nothing, and so is a form `action`.
 */
export const FRAGMENT_REFERENCE_PROPS: readonly string[] = ["href", "url"];

const FRAGMENT_REFERENCE_SET = new Set(FRAGMENT_REFERENCE_PROPS);

/**
 * Rewrite every link target in a prop tree that names an id this copy minted.
 *
 * Returns the SAME value when nothing matched, so an ordinary block allocates
 * nothing and a caller can compare by identity to tell whether anything moved.
 *
 * ## Bounded by the input, not by a number
 *
 * There was a cap here — first on depth, then on values visited — and both were
 * wrong the same way: each was a guess about how large a legitimate prop tree
 * gets, and a document exceeding the guess had its links silently left dangling
 * rather than being refused. A depth cap of eight could not reach a rich-text
 * link inside a list item, which is ten values down. A budget of twenty
 * thousand visits was reachable by a rich-text value of a few hundred kilobytes
 * — well inside the document size limit — so it was the same silent failure,
 * moved further away rather than removed.
 *
 * A prop tree is part of a document, and how large a document may be is already
 * decided once, by the document limits. Scanning all of it is therefore bounded
 * work already, and the only thing a cap was really buying was TERMINATION on a
 * value that refers to itself. That is what the path set does, exactly as
 * `mapForest` does it one module over.
 */
export function remapFragmentProps(
  props: unknown,
  domIds: ReadonlyMap<string, string>
): unknown {
  if (domIds.size === 0) return props;
  return scan(props, domIds, new Set());
}

/**
 * Rewrite a bound prop's FALLBACK when that prop holds a link target.
 *
 * A bound `href` keeps its literal in `bindings.href.fallback`, and the binding
 * contract renders exactly that when the source is empty or the path cannot
 * resolve. A copy that moves the target and rewrites `props.href` while leaving
 * the fallback behind therefore produces a link that works until the data does
 * not — the worst shape this failure can take, because it appears only in the
 * case the fallback exists to cover.
 */
export function remapFragmentBindings(
  bindings: unknown,
  domIds: ReadonlyMap<string, string>
): unknown {
  if (domIds.size === 0 || !isPlainRecord(bindings)) return bindings;
  const keys = boundedOwnKeys(bindings, MAX_ENVELOPE_ENTRIES);
  if (keys === null) return bindings;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    const binding = ownEntry(bindings, key);
    const mapped = FRAGMENT_REFERENCE_SET.has(key)
      ? withRemappedFallback(binding, domIds)
      : binding;
    if (mapped !== binding) changed = true;
    defineEntry(next, key, mapped);
  }
  return changed ? next : bindings;
}

/** One binding, with a fragment fallback pointed at the copy's own target. */
function withRemappedFallback(
  binding: unknown,
  domIds: ReadonlyMap<string, string>
): unknown {
  if (!isPlainRecord(binding)) return binding;
  const fallback = ownEntry(binding, "fallback");
  if (typeof fallback !== "string") return binding;
  const mapped = remapOneFragment(fallback, domIds);
  return mapped === fallback ? binding : { ...binding, fallback: mapped };
}

/**
 * One value: descended into, or returned as it stands.
 *
 * `onPath` holds the objects between here and the root of this walk. A value
 * re-entered while it is still on the path is a cycle, and returning it
 * untouched is what makes this terminate — stored JSON cannot hold one, but a
 * structured clone of an in-memory object can, and these primitives are
 * documented as running on documents nothing has validated.
 *
 * A PATH rather than everything seen, because a prop tree may legitimately
 * reach one object from two places, and a value that has merely been visited
 * before still needs rewriting where it appears again.
 */
function scan(
  value: unknown,
  domIds: ReadonlyMap<string, string>,
  onPath: Set<unknown>
): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (onPath.has(value)) return value;
  onPath.add(value);
  const out = Array.isArray(value)
    ? scanList(value, domIds, onPath)
    : isPlainRecord(value)
      ? scanRecord(value, domIds, onPath)
      : value;
  onPath.delete(value);
  return out;
}

/**
 * A record, with an allowlisted string field rewritten and everything else
 * descended into.
 *
 * The name is checked HERE because this is the only place a value is reached
 * with the field that holds it still in hand. A string inside an array carries
 * no name of its own and is never rewritten on its own account — but
 * `cta.links[0].href` still is, because that string is reached as the value of
 * `href` on the record inside the array.
 */
function scanRecord(
  record: Record<string, unknown>,
  domIds: ReadonlyMap<string, string>,
  onPath: Set<unknown>
): unknown {
  const keys = boundedOwnKeys(record, MAX_ENVELOPE_ENTRIES);
  if (keys === null) return record;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    const value = ownEntry(record, key);
    const mapped =
      FRAGMENT_REFERENCE_SET.has(key) && typeof value === "string"
        ? remapOneFragment(value, domIds)
        : scan(value, domIds, onPath);
    if (mapped !== value) changed = true;
    defineEntry(next, key, mapped);
  }
  return changed ? next : record;
}

/** An array, descended into item by item. */
function scanList(
  items: readonly unknown[],
  domIds: ReadonlyMap<string, string>,
  onPath: Set<unknown>
): unknown {
  let changed = false;
  const next = items.map(item => {
    const mapped = scan(item, domIds, onPath);
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? next : items;
}

/** One target, rewritten only if it is exactly a fragment this run minted. */
function remapOneFragment(
  value: string,
  domIds: ReadonlyMap<string, string>
): string {
  if (!value.startsWith("#")) return value;
  const target = domIds.get(value.slice(1));
  return target === undefined ? value : `#${target}`;
}
