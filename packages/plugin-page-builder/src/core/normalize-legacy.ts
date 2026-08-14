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
  registry: BlockRegistry
): BlockNode {
  const stored = node.slots;
  if (!stored) return node;

  const declared = slotsOf(node.type, registry);
  let changed = false;
  const slots: Record<string, BlockNode[]> = {};

  for (const [slotName, children] of Object.entries(stored)) {
    const spec = declared?.find(s => s.name === slotName);
    const next = children.map(child => {
      const deeper = normalizeLegacySlots(child, registry);
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
      // and version rather than whatever this call remembered to pass.
      return createNode(wrapperType, registry, { [DEFAULT_SLOT]: [deeper] });
    });
    slots[slotName] = next;
  }

  return changed ? { ...node, slots } : node;
}
