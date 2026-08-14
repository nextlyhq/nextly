/**
 * Bringing a stored document up to the shape its blocks now declare, for READING.
 *
 * A slot can gain an allowlist after pages have been saved through it. `core/columns` is the case
 * that forced this: it accepted any block and laid each one out as a column, and now it accepts
 * only `core/column`, which draws that layout itself. Every page saved before the change holds
 * ordinary blocks directly in that row.
 *
 * Nothing migrates them on the way to a reader. `PageRenderer` prunes undeclared slots and renders
 * what it finds, so those children would arrive at a row that no longer wraps them — and a LIVE
 * published page would change layout the moment the new block shipped, before its author opened
 * the editor or saw the repair banner. That is a regression a visitor meets, not an author.
 *
 * ## Why this is a document transform and not a branch inside the block
 *
 * The obvious alternative is for `core/columns` to keep its historical wrapper for children that
 * are not columns. It works, and it breaks something worse: `childLayout` is a declaration the
 * CANVAS trusts, read to decide whether a zero-height drop zone may be interleaved between
 * children, and read before any child is examined. A per-child wrapper makes that declaration
 * conditional on data nothing consults at that point — true of some rows, false of others, with
 * nothing distinguishing them. The interleaved zone in such a row stops being free: it becomes a
 * flex cell, takes a gap, and shifts every child after it, which is a reflow on dragstart in the
 * one arrangement nobody would think to test.
 *
 * So the divergence is removed rather than tolerated. One representation reaches every reader; two
 * representations would have to be understood by the renderer, the canvas and everything added
 * later, permanently.
 *
 * 🔴 FOR READING ONLY, exactly as `pruneUndeclaredSlots` is. The result must never be written
 * back: repairing the STORED document is the repair banner's job, which the author takes
 * deliberately and can undo. This only decides what a page DISPLAYS in the meantime.
 *
 * @module core/normalize-legacy
 */
import { slotsOf } from "./block-structure";
import { createNode, type BlockRegistry } from "./registry";
import { slotAdmits } from "./slot-allow";
import { DEFAULT_SLOT, type BlockNode, type SlotSpec } from "./types";

/**
 * Marks an id this transform derived rather than one an author's document stored.
 *
 * Distinguishable on sight when it appears in a class name or a React key. It is NOT a guarantee
 * of uniqueness: a stored document may legitimately contain a node whose id is already
 * `legacy-wrap:x`, and nothing forbids it — ids come from plugins and from hand-authored JSON as
 * well as from `crypto.randomUUID()`. Uniqueness is established against the actual document
 * instead, by {@link freeId}.
 */
const LEGACY_WRAPPER_PREFIX = "legacy-wrap:";

/** Every id in this tree, so a derived one can be checked against what is really there. */
function collectIds(node: BlockNode, into: Set<string>): Set<string> {
  into.add(node.id);
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) collectIds(child, into);
  }
  return into;
}

/**
 * A derived id that is not already in use, and the reservation that keeps it that way.
 *
 * A duplicate id is not cosmetic here: `documentNodeClasses` and the style compiler key nodes BY
 * ID, so two nodes sharing one produce one selector — styles meant for the author's node land on
 * the synthetic column, or hide it, on the published page.
 *
 * Suffixed rather than randomised on collision, because this runs on the server and again on the
 * client for one stored document and the two passes must agree. The same input yields the same
 * suffix, since the ids it checks against are the same both times.
 */
function freeId(base: string, taken: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}#${String(n)}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * The one type a slot would accept in place of a child it refuses, if there is exactly one.
 *
 * Deliberately narrow, and every clause removes a way of guessing wrong:
 *
 * - the slot must name exactly ONE permitted type, so nothing is chosen on the reader's behalf;
 * - that type must be REGISTERED here, because this wraps by constructing a node and drawing it —
 *   a type known only to the engine registry would render as an unknown-block placeholder and
 *   hide the very child it was preserving;
 * - it must be a container whose own default slot admits the child, or the wrapper cannot hold
 *   what it is being asked to hold.
 *
 * A wildcard entry is not a wrapper. `core/*` names a namespace rather than a block, so there is
 * nothing to construct, and `slotAdmits` would already have accepted any core child.
 */
function wrapperForRefusedChild(
  spec: SlotSpec,
  child: BlockNode,
  registry: BlockRegistry
): string | undefined {
  const permitted = spec.allowedBlocks;
  if (!permitted || permitted.length !== 1) return undefined;
  const wrapperType = permitted[0];
  if (wrapperType.endsWith("/*")) return undefined;
  const def = registry.get(wrapperType);
  if (!def?.isContainer) return undefined;
  const inner = (def.slots ?? []).find(s => s.name === DEFAULT_SLOT);
  if (!inner || !slotAdmits(inner, child.type)) return undefined;
  return wrapperType;
}

/**
 * A copy of the tree in which every child a slot refuses sits inside the one block that slot does
 * accept.
 *
 * Returns the SAME node when nothing changed, so a document already in the current shape — which
 * is every document saved since the change — is not rebuilt, and callers comparing by identity
 * keep working. That also makes this cheap on the common path: one walk, no allocation.
 *
 * Idempotent by construction rather than by a flag: after one pass every child is admitted by the
 * slot holding it, so a second pass finds nothing to do.
 */
export function normalizeLegacySlots(
  node: BlockNode,
  registry: BlockRegistry,
  /**
   * Ids already in use, collected from the WHOLE tree before any wrapper is made.
   *
   * Gathered once at the entry rather than per node: a derived id must avoid every stored id in
   * the document, including ones in branches this walk has not reached yet, and a check that only
   * knew the ids it had already passed would collide with anything below it.
   */
  taken: Set<string> = collectIds(node, new Set())
): BlockNode {
  const stored = node.slots;
  if (!stored) return node;

  const declared = slotsOf(node.type, registry);
  let changed = false;
  const slots: Record<string, BlockNode[]> = {};

  for (const [slotName, children] of Object.entries(stored)) {
    const spec = declared?.find(s => s.name === slotName);
    const next = children.map(child => {
      const deeper = normalizeLegacySlots(child, registry, taken);
      // A child the slot already accepts is left exactly as it is, including its identity.
      if (!spec || slotAdmits(spec, child.type)) {
        if (deeper !== child) changed = true;
        return deeper;
      }
      const wrapperType = wrapperForRefusedChild(spec, child, registry);
      // No single answer, or none this build can draw: the child is left in place. It renders as
      // it did before rather than being hidden or discarded, and the repair banner still reports
      // the document as unsaveable — which is the honest state, since nothing here repairs it.
      if (!wrapperType) {
        if (deeper !== child) changed = true;
        return deeper;
      }
      changed = true;
      // Through the shared constructor, so the wrapper carries its definition's defaults, style
      // and version rather than whatever this call remembered to pass — but with a DERIVED id.
      //
      // `createNode` assigns `crypto.randomUUID()`, which is right for a node an author created
      // and wrong for one a read produces. This transform runs on the server and again on the
      // client for the same stored document, and a node's id drives its scoped CSS class: a random
      // one differs between the two passes, so the markup and the compiled stylesheet disagree and
      // React reports a hydration mismatch on a page nobody edited.
      //
      // Derived from the child it wraps, which is stable across passes and unique because the
      // child's own id is. The prefix keeps it from colliding with a stored id.
      const wrapper = createNode(wrapperType, registry, {
        [DEFAULT_SLOT]: [deeper],
      });
      return {
        ...wrapper,
        id: freeId(`${LEGACY_WRAPPER_PREFIX}${child.id}`, taken),
      };
    });
    slots[slotName] = next;
  }

  return changed ? { ...node, slots } : node;
}
