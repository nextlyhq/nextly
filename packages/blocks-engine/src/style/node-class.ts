/**
 * The CSS class a node's styles are written against.
 *
 * Derived from the node's ID, not from its styles. A block therefore keeps the
 * same class for life: editing a style swaps the stylesheet and never touches
 * the DOM `className`, so the canvas does not churn its markup on every commit
 * and anything targeting a node by selector keeps working across edits. The
 * cost is that two identically styled nodes emit the same declarations twice,
 * which is a compiler-internal dedup opportunity later and never a format
 * change. Sharing styles deliberately is what named classes are for.
 *
 * @module style/node-class
 */

/** The prefix on every compiler-generated node class. */
export const NODE_CLASS_PREFIX = "nx-pb-";

/** The class on the page root that every emitted selector is anchored to. */
export const PAGE_ROOT_CLASS = "nx-pb-page";

/**
 * The page root as it is written into a selector, with its class REPEATED.
 *
 * Repeating a class is the standard way to buy a notch of specificity without
 * reaching for `!important`, and the notch is the whole point: a builder rule
 * sits at 0-3-0 rather than 0-2-0, so ordinary host CSS like
 * `.content .card h1` (0-2-1) no longer beats a value the author set in the
 * builder. Losing that contest is the failure users actually report — a style
 * set in the editor that silently does not appear on the page.
 *
 * It costs deliberate overrides one rung, and that trade is the contract: a
 * host rule with higher specificity or `!important` still wins, so the page
 * remains the user's. `!important` is not used here precisely so that remains
 * true — it would end the argument instead of winning it.
 *
 * One constant rather than the literal repeated at call sites: the number of
 * repetitions IS the override contract, and a contract with two definitions has
 * none.
 */
export const PAGE_ROOT_SELECTOR = `.${PAGE_ROOT_CLASS}.${PAGE_ROOT_CLASS}`;

/** The prefix on the shared class carrying one block type's base styles. */
export const BLOCK_TYPE_CLASS_PREFIX = "nx-bt-";

/**
 * The class an element wears to opt into the site's content width.
 *
 * Here rather than beside the container block that applies it, because the rule
 * behind it is emitted by the site stylesheet — and a selector written in one
 * package against a name owned by another is a contract with two definitions,
 * which is the arrangement this file exists to refuse.
 *
 * A CLASS rather than a block-type default, and the distinction is what makes
 * it necessary: containment is a PROP, so every container of a given type wears
 * the same block-type class whether it opted in or not. A default keyed by type
 * would constrain the ones that declined. The same argument the typographic
 * defaults make about a heading's level, one tier along.
 */
export const CONTENT_WIDTH_CLASS = `${NODE_CLASS_PREFIX}contained`;

/**
 * A 53-bit hash of an id, in base 36.
 *
 * Two FNV-1a lanes with different multipliers, combined into one integer that a
 * double represents exactly. One 32-bit lane over 5,000 ids carries roughly a
 * 1-in-350 chance of a collision, which is often enough to meet on a large
 * page; 53 bits puts it below one in a million million.
 *
 * It is not a security primitive and does not need to be. A collision is
 * detected in {@link nodeClassNames} and disambiguated, so a document carrying
 * two ids chosen to collide gets two different classes rather than one node
 * wearing another's styles.
 */
export function hashId(id: string): string {
  let low = 0x811c9dc5;
  let high = 0xc2b2ae35;
  for (let index = 0; index < id.length; index += 1) {
    const code = id.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ code, 0x85ebca6b);
  }
  // 32 bits from one lane and 21 from the other: 53 is every bit a double holds
  // without rounding, so the value below is exact and `toString` is stable.
  const combined = (low >>> 0) * 2 ** 21 + (high >>> 11);
  return combined.toString(36);
}

/**
 * Compare by code unit rather than by locale.
 *
 * `localeCompare` reads the runtime's collation, so the same document would
 * serialize differently on two machines and the byte-determinism guarantee
 * would hold only by luck.
 */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * The class for every id, with any hash collision resolved.
 *
 * Collisions are ranked by the colliding IDs themselves, never by where they
 * appear in the document: a node that moves must keep its class, or reordering
 * a page would rewrite both the stylesheet and the markup for nodes nobody
 * edited.
 *
 * `hash` is a parameter so the collision path can be exercised directly. The
 * real hash makes collisions too rare to reach any other way, and an untested
 * branch on the one path that produces duplicate class names is not worth the
 * shorter signature.
 */
export function nodeClassNames(
  ids: readonly string[],
  hash: (id: string) => string = hashId
): Map<string, string> {
  const byHash = new Map<string, string[]>();
  for (const id of ids) {
    const key = hash(id);
    const group = byHash.get(key);
    if (group === undefined) {
      byHash.set(key, [id]);
      // Duplicate ids are a validation error, and the compiler does not assume
      // validation ran. Collapsing them here means one class per id whatever it
      // was handed, rather than a node ranked against a copy of itself.
    } else if (!group.includes(id)) {
      group.push(id);
    }
  }
  const names = new Map<string, string>();
  for (const [key, group] of byHash) {
    const single = group.length === 1 ? group[0] : undefined;
    if (single !== undefined) {
      names.set(single, NODE_CLASS_PREFIX + key);
      continue;
    }
    const ranked = [...group].sort(byCodeUnit);
    ranked.forEach((id, index) => {
      names.set(id, `${NODE_CLASS_PREFIX}${key}-${index}`);
    });
  }
  return names;
}

/**
 * The class for one id, ignoring collisions.
 *
 * For a caller holding a single node and no document around it: the editor
 * asking which selector to scrub, a test naming an expected class. A whole
 * document goes through {@link nodeClassNames}, which is the only place that
 * can see a collision at all.
 */
export function nodeClassName(id: string): string {
  return NODE_CLASS_PREFIX + hashId(id);
}

/**
 * The shared class carrying a block type's base styles.
 *
 * A block type is a namespaced slug (`core/section`) and `/` is not a class
 * character, so the separator becomes a DOUBLE dash. A single one would not be
 * reversible: a segment is `[a-z0-9]+(-[a-z0-9]+)*`, so `foo-bar/baz` and
 * `foo/bar-baz` would both become `foo-bar-baz`, and two block types would
 * share one selector with the later one's defaults silently applying to both.
 * A doubled dash cannot occur inside a segment, so it is free to mean this.
 */
export function blockTypeClassName(type: string): string {
  return BLOCK_TYPE_CLASS_PREFIX + type.replace(/\//g, "--");
}
