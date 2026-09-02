/**
 * Whether the nesting rule refuses a move, and the words for saying so.
 *
 * ## This DECIDES, and it has to
 *
 * The op store does not ask the nesting rule — measured, zero references to it
 * in `ops.ts`, with a control showing the symbol resolves elsewhere in the
 * package. So a placement the rule forbids is not refused at apply time; it is
 * applied. The POINTER route is stopped because `drop-targets` asks
 * `blockAllowedAt` before a drop resolves, and until this module was called
 * before the move rather than after it, the keyboard route asked nobody. A
 * keyboard author could therefore build a document a pointer author cannot.
 *
 * So this is the keyboard route's half of a decision the pointer route already
 * makes, asked of the same function, rather than a second implementation of it:
 * `blockAllowedAt` is the one answer and both surfaces ask it.
 *
 * ## It does NOT move the question into `keyboard-move`
 *
 * That module answers where a block goes and says in its own docblock that it
 * "answers WHERE, never WHETHER". It still does. The wiring asks whether — as
 * the pointer wiring does — and the position function stays positional.
 *
 * ## Null is an honest answer, and it means ALLOWED
 *
 * Null is "the nesting rule does not refuse this", never "something went
 * wrong". A move can still fail after this returns null — a byte cap, a depth
 * limit, an op the forest rejects — and those are the store's to refuse and its
 * caller's to report, without a nesting cause being invented for them.
 *
 * @module move-refusal
 */
import type { BlockDocument, NestingSource } from "@nextlyhq/blocks-engine";
import { findNode } from "@nextlyhq/blocks-engine";

import { refusalWording, type RefusalWording } from "./drag-refusal";
import { blockAllowedAt } from "./inserter";
import type { OpPosition } from "./ops";

/**
 * The nesting rule's refusal for a proposed move, or `null` if it permits it.
 *
 * Asked BEFORE the move is applied, which is what makes it a refusal rather
 * than a post-mortem.
 *
 * @param document - the document the move would change
 * @param movingId - the block being moved
 * @param to - the position it would move to
 * @param nesting - the rule source, the same one the pointer route asks
 * @returns the refusal's headline and remedy, or `null` when it is permitted
 */
export function nestingRefusalForMove(
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
  // ALLOWED is null: the rule permits this placement. Whether it survives the
  // store's own limits is a later question with a different answer.
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
