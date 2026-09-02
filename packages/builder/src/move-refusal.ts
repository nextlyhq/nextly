/**
 * Why a move the store refused was refused, in words an author can act on.
 *
 * A DIAGNOSIS, never a decision, and the distinction is the whole design.
 * `keyboard-move` answers where a block goes and says in its own docblock that
 * it "answers WHERE, never WHETHER", because validity belongs to the op store
 * and asking a second time is a second implementation of one question. This
 * module does not ask whether the move may happen — the store has already said
 * no — it asks what the nesting rule would say about a placement that has
 * already been refused, so the refusal can be spoken.
 *
 * That ordering is what keeps it from becoming a second gate. Nothing here can
 * permit or forbid anything: it runs only after `apply` returned null, and its
 * answer changes what is ANNOUNCED and nothing else.
 *
 * ## Why the reason has to be recovered rather than relayed
 *
 * `EditorState.apply` returns `BlockDocument | null`. The null carries no
 * reason, so a caller that wants to explain a refusal cannot pass one on. The
 * choice is between recovering the reason here and widening the store's return
 * type — and widening it would make every caller handle a value only this one
 * needs, for a case the store itself does not have words for.
 *
 * ## Null is an honest answer
 *
 * The store refuses for reasons beyond nesting: a document at its byte cap, a
 * depth limit, an op the forest rejects. When the nesting rule would have
 * ALLOWED the placement, this returns null rather than inventing a reason, and
 * the caller says only that the move did not happen. Naming a nesting cause
 * that was not the cause would send an author to fix the wrong thing, which is
 * worse than a sentence that admits it does not know.
 *
 * @module move-refusal
 */
import type { BlockDocument, NestingSource } from "@nextlyhq/blocks-engine";
import { findNode } from "@nextlyhq/blocks-engine";

import { refusalWording, type RefusalWording } from "./drag-refusal";
import { blockAllowedAt } from "./inserter";
import type { OpPosition } from "./ops";

/**
 * The words for a refused move, or `null` when nesting does not explain it.
 *
 * @param document - the document the move was attempted against
 * @param movingId - the block that was being moved
 * @param to - the position it was being moved to
 * @param nesting - the rule source, the same one the pointer route asks
 * @returns the refusal's headline and remedy, or `null`
 */
export function refusedMoveWording(
  document: BlockDocument,
  movingId: string,
  to: OpPosition,
  nesting: NestingSource
): RefusalWording | null {
  const moving = findNode(document.nodes, movingId);
  if (moving === undefined) return null;

  /*
   * The destination as the nesting rule describes it. A position with no
   * `parentId` is the root, which the rule treats as its own case rather than
   * as a slot with no container — a block restricted to living inside
   * something is refused AT the root for a reason no slot could give.
   */
  const parent =
    to.parentId === undefined
      ? undefined
      : findNode(document.nodes, to.parentId);
  if (to.parentId !== undefined && parent === undefined) return null;
  const target =
    parent === undefined
      ? ({ at: "root" } as const)
      : ({ at: "slot", parentType: parent.type, slot: to.slot ?? "" } as const);

  const verdict = blockAllowedAt(moving.type, target, nesting);
  // ALLOWED means nesting was not the cause. Something else in the store
  // refused, and this module has nothing true to say about it.
  if (verdict.allowed) return null;

  return refusalWording(verdict, moving.type, parent?.type);
}

/**
 * One sentence for a refused move, ready to announce.
 *
 * Joined here rather than by the caller so the two halves cannot drift apart in
 * spacing or order between the surfaces that speak them. The remedy is omitted
 * rather than replaced when the engine named nothing — a trailing fragment
 * would read as a sentence that was cut off.
 *
 * @param wording - the refusal's two lines
 * @returns the announcement text
 */
export function refusalAnnouncement(wording: RefusalWording): string {
  return wording.remedy === null
    ? wording.headline
    : `${wording.headline} ${wording.remedy}`;
}
