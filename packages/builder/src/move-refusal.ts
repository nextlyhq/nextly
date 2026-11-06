/**
 * Whether the nesting rule refuses a move, and the words for saying so.
 *
 * ## This DECIDES, and it has to
 *
 * The op store does not ask the nesting rule — measured, zero references to it
 * in `ops.ts`, with a control showing the symbol resolves elsewhere in the
 * package. So a placement the rule forbids is not refused at apply time; it is
 * applied. The POINTER route is stopped because `drop-targets` asks
 * `placementVerdict` before a drop resolves; the keyboard route asks this,
 * before the move, for the same reason. Without it a keyboard author builds
 * documents a pointer author cannot.
 *
 * So this is the keyboard route's half of a decision the pointer route already
 * makes, asked of the same function, rather than a second implementation of it:
 * `placementVerdict` is the one answer and both surfaces ask it — of the same
 * types, too. A component instance is judged by the ROOTS of the definition it
 * draws (`placementTypesOf`), as a drop is, because the instance node's own
 * type is not a registered block and the nesting source restricts it nowhere.
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
import type {
  BlockDocument,
  ComponentLookup,
  NestingSource,
} from "@nextlyhq/blocks-engine";
import { canPlaceIn, findNode } from "@nextlyhq/blocks-engine";

import { placementWording, type RefusalWording } from "./drag-refusal";
import { placementSources } from "./drop-targets";
import { layerLabel } from "./layers";
import type { OpPosition } from "./op-vocabulary";

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
 * @param definitions - the component definitions the canvas draws, so an
 *   instance is judged by what it draws; without one, by its own type
 * @returns the refusal's headline and remedy, or `null` when it is permitted
 */
export function nestingRefusalForMove(
  document: BlockDocument,
  movingId: string,
  to: OpPosition,
  nesting: NestingSource,
  definitions?: ComponentLookup
): RefusalWording | null {
  const moving = findNode(document.nodes, movingId);
  if (moving === undefined) return null;
  const parent =
    to.parentId === undefined
      ? undefined
      : findNode(document.nodes, to.parentId);
  if (to.parentId !== undefined && parent === undefined) return null;
  // The one placement rule, over the moving block and everything it holds, at
  // the destination with what its ancestors refuse. A position whose slot is
  // unnamed is the root's.
  const verdict = canPlaceIn(
    document.nodes,
    [moving],
    parent === undefined
      ? { kind: "root" }
      : { kind: "slot", parentId: parent.id, slot: to.slot ?? "" },
    placementSources({
      nesting,
      ...(definitions === undefined ? {} : { definitions }),
    })
  );
  // ALLOWED is null: the rule permits this placement. Whether it survives the
  // store's own limits is a later question with a different answer.
  if (verdict.allowed) return null;
  // Worded by the node being moved, as the pointer route words a refused drop:
  // the author picked up the instance, not the root inside it that refused.
  return placementWording(verdict, moving.type, parent?.type);
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

/**
 * What is said when the store refused a move nothing judged beforehand would
 * refuse: a byte cap, a depth limit, an op the forest rejects. It names no
 * cause, because none was established, and it is still said, because a move
 * that was attempted and did not happen cannot otherwise be told apart from
 * one that did.
 *
 * @param document - the document the move was asked of
 * @param id - the block that did not move
 * @returns the announcement text
 */
export function unmovedAnnouncement(
  document: BlockDocument,
  id: string
): string {
  const block = findNode(document.nodes, id);
  return `${block === undefined ? "The block" : layerLabel(block)} could not be moved.`;
}
