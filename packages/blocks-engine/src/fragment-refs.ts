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
import { isPlainRecord } from "./plain-record";
import { defineEntry, ownEntry, ownKeys } from "./safe-record";

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
 * ## Bounded by the document, not by a number of its own
 *
 * There were two caps here — first on depth, then on values visited — and both
 * were guesses about how large a legitimate prop tree gets. Each time a valid
 * document exceeded the guess, its links were silently left dangling rather
 * than the document being refused, so raising the number only moved the same
 * failure further away. A third borrowed bound did the same thing sideways: the
 * component-envelope key budget was applied to opaque prop records, which the
 * format does not cap at all, so a record of a thousand keys was returned
 * untouched and counted as done.
 *
 * How large a document may be is decided once, by the document limits. A prop
 * tree is part of one, so walking all of it is bounded work already, and every
 * bound this module added was solving a problem it did not have.
 *
 * ## Iterative, because a valid tree can be deeper than the stack
 *
 * Roughly three thousand nested records — tens of kilobytes, well inside the
 * document byte limit — exhausted the call stack under a recursive walk. Depth
 * is a property of authored content and not something this module may refuse,
 * so the walk carries its own stack, the way the forest walker does for exactly
 * the same reason.
 *
 * ## One replacement per source object
 *
 * The map is what makes a graph come out a graph. A record reached twice is
 * rebuilt once and both edges point at that one rebuild — so a cycle closes on
 * the REPLACEMENT rather than on the original, which is the bug a path-set
 * guard leaves behind: it terminates, but the copy ends up holding an edge back
 * to the original object, still carrying the id this pass just rewrote. Shared
 * structure that is not cyclic is preserved for the same reason, rather than
 * being duplicated into two divergent copies.
 */
export function remapFragmentProps(
  props: unknown,
  domIds: ReadonlyMap<string, string>
): unknown {
  if (domIds.size === 0 || !isTraversable(props)) return props;

  const copy = shellFor(props);
  const run: Rebuild = {
    domIds,
    copies: new Map([[props, copy]]),
    stack: [frameFor(props, copy)],
    changed: false,
  };
  while (run.stack.length > 0) step(run);

  // Nothing matched, so the copy describes exactly what was already there and
  // the caller learns "unchanged" from identity rather than from a comparison.
  return run.changed ? copy : props;
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
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const key of ownKeys(bindings)) {
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

/** A value this walk descends into: a plain record, or an array. */
type Traversable = Record<string, unknown> | unknown[];

/** One object being rebuilt, and how far through its entries the walk is. */
interface Frame {
  readonly source: Traversable;
  readonly copy: Traversable;
  /** The source's own keys, or `null` when it is an array. */
  readonly keys: string[] | null;
  index: number;
}

/** Everything one rebuild carries between steps. */
interface Rebuild {
  readonly domIds: ReadonlyMap<string, string>;
  /** Source object → the single replacement standing in for it. */
  readonly copies: Map<Traversable, Traversable>;
  readonly stack: Frame[];
  changed: boolean;
}

function isTraversable(value: unknown): value is Traversable {
  return Array.isArray(value) || isPlainRecord(value);
}

/** An empty replacement of the same shape, filled in as the walk proceeds. */
function shellFor(value: Traversable): Traversable {
  return Array.isArray(value) ? [] : {};
}

function frameFor(source: Traversable, copy: Traversable): Frame {
  return {
    source,
    copy,
    keys: Array.isArray(source) ? null : ownKeys(source),
    index: 0,
  };
}

/** How many entries a frame has to get through. */
function sizeOf(frame: Frame): number {
  return frame.keys === null
    ? (frame.source as unknown[]).length
    : frame.keys.length;
}

/** One entry of the frame on top of the stack. */
function step(run: Rebuild): void {
  const frame = run.stack[run.stack.length - 1];
  if (frame === undefined) return;
  if (frame.index >= sizeOf(frame)) {
    run.stack.pop();
    return;
  }
  const at = frame.index;
  frame.index += 1;
  const key = frame.keys === null ? null : (frame.keys[at] ?? null);
  const value =
    key === null
      ? (frame.source as unknown[])[at]
      : ownEntry(frame.source as Record<string, unknown>, key);
  const resolved = resolveEntry(run, key, value);
  if (key === null) (frame.copy as unknown[])[at] = resolved;
  else defineEntry(frame.copy as Record<string, unknown>, key, resolved);
}

/**
 * What one entry becomes in the copy.
 *
 * The field name is checked HERE because this is the only place a value is
 * reached with the field that holds it still in hand. A string inside an array
 * carries no name of its own and is never rewritten on its own account — but
 * `cta.links[0].href` still is, because that string is reached as the value of
 * `href` on the record inside the array.
 */
function resolveEntry(
  run: Rebuild,
  key: string | null,
  value: unknown
): unknown {
  if (key !== null && FRAGMENT_REFERENCE_SET.has(key)) {
    if (typeof value !== "string") return descend(run, value);
    const mapped = remapOneFragment(value, run.domIds);
    if (mapped !== value) run.changed = true;
    return mapped;
  }
  return descend(run, value);
}

/** A child object's single replacement, queued for filling if it is new. */
function descend(run: Rebuild, value: unknown): unknown {
  if (!isTraversable(value)) return value;
  const existing = run.copies.get(value);
  if (existing !== undefined) return existing;
  const copy = shellFor(value);
  run.copies.set(value, copy);
  run.stack.push(frameFor(value, copy));
  return copy;
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
