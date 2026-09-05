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
 * How many values one prop tree may be scanned for.
 *
 * A bound on WORK, not on depth. Depth was the wrong quantity and it was set
 * too low to be safe either way: a rich-text link inside a list item sits at
 * `props → content → root → children → item → children → listitem → children →
 * link → url`, which is ten values down, so an ordinary authored link was
 * already past a cap of eight and was silently left dangling. Any fixed depth
 * is arbitrary here, because rich text nests lists as deeply as an author
 * nests them.
 *
 * Counting visits bounds what a wide tree costs as well as a deep one, and it
 * terminates on a value that refers to itself — which stored JSON cannot be,
 * but a structured clone of an in-memory object can.
 */
const MAX_PROP_SCAN_VISITS = 20_000;

/** A visit budget, spent as the walk reads values. */
interface ScanBudget {
  left: number;
}

/**
 * Rewrite every link target in a prop tree that names an id this copy minted.
 *
 * Returns the SAME value when nothing matched, so an ordinary block allocates
 * nothing and a caller can compare by identity to tell whether anything moved.
 */
export function remapFragmentProps(
  props: unknown,
  domIds: ReadonlyMap<string, string>
): unknown {
  if (domIds.size === 0) return props;
  return scan(props, domIds, { left: MAX_PROP_SCAN_VISITS });
}

/** One value: descended into, or returned as it stands. */
function scan(
  value: unknown,
  domIds: ReadonlyMap<string, string>,
  budget: ScanBudget
): unknown {
  if (budget.left <= 0) return value;
  budget.left -= 1;
  if (Array.isArray(value)) return scanList(value, domIds, budget);
  if (!isPlainRecord(value)) return value;
  return scanRecord(value, domIds, budget);
}

/**
 * A record, with an allowlisted string field rewritten and everything else
 * descended into.
 *
 * The name is checked HERE because this is the only place a value is reached
 * with the field that holds it still in hand. A string found inside an array
 * carries no name of its own and is never rewritten on its own account — but
 * `cta.links[0].href` still is, because that string is reached as the value of
 * `href` on the record inside the array.
 */
function scanRecord(
  record: Record<string, unknown>,
  domIds: ReadonlyMap<string, string>,
  budget: ScanBudget
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
        : scan(value, domIds, budget);
    if (mapped !== value) changed = true;
    defineEntry(next, key, mapped);
  }
  return changed ? next : record;
}

/** An array, descended into item by item. */
function scanList(
  items: readonly unknown[],
  domIds: ReadonlyMap<string, string>,
  budget: ScanBudget
): unknown {
  let changed = false;
  const next = items.map(item => {
    const mapped = scan(item, domIds, budget);
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
