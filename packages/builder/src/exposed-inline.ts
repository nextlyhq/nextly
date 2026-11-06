/**
 * Typing into a component's exposed text on the canvas.
 *
 * A component is inlined at render: the element an author double-clicks
 * belongs to a re-identified node that the page document does not hold, so the
 * ordinary inline edit, which finds its node in the page, finds nothing. The
 * value it shows comes from the placement, through one of the component's
 * exposures, and that is where an edit has to go.
 *
 * The editor's composition carries the resolver's exposure map
 * (`exposedProps`): which exposure feeds each prop of a composed node, for the
 * host placement's own component only. So the answer is read, never rebuilt:
 * the composed node names its placement (`instanceOf`) and the exposure, and
 * the edit is the placement's own value under that exposure's id — one op, so
 * one undo step, exactly what the panel's field writes.
 *
 * Text the component does not expose is part of the component's design. A
 * double-click there selects the placement and says so, rather than doing
 * nothing.
 *
 * @module exposed-inline
 */
import {
  authoredText,
  findNode,
  getBlock,
  isComponentInstance,
  isRichTextValue,
  registryBlockSource,
  type BlockDocument,
  type BlockNode,
  type ResolvedBlockNode,
  type RichTextValue,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import { composedHolds } from "./component-holds";
import { inlinePropKind } from "./inline-prop-kind";
import { richTextChanged } from "./inline-rich-text";
import { setOverrideOp } from "./instance-inspector";
import { lockBlockingEdit } from "./locking";
import type { BuilderOp } from "./op-vocabulary";

/** An exposed value the canvas may edit in place, addressed through its placement. */
export interface ExposedTextTarget {
  /** The composed node the element belongs to, as the canvas addresses it. */
  readonly nodeId: string;
  readonly prop: string;
  /** The placement the value is stored on, a node of the page document. */
  readonly placementId: string;
  /** The exposure id the value is stored under. */
  readonly exposureId: string;
  readonly multiline: boolean;
  /** The value the page shows now. */
  readonly value: string;
}

/**
 * An exposed passage the canvas may edit in place, addressed through its
 * placement. The passage itself is read when the editor opens and again when
 * it closes ({@link exposedPassage}), never carried, so a change made to it
 * meanwhile is seen.
 */
export interface ExposedRichTarget {
  /** The composed node the element belongs to, as the canvas addresses it. */
  readonly nodeId: string;
  readonly prop: string;
  /** The placement the passage is stored on, a node of the page document. */
  readonly placementId: string;
  /** The exposure id the passage is stored under. */
  readonly exposureId: string;
}

/** What a double-click on a component's text means. */
export type ComposedTextAnswer =
  | { readonly kind: "exposed"; readonly target: ExposedTextTarget }
  | { readonly kind: "exposed-rich"; readonly target: ExposedRichTarget }
  /**
   * Not editable here: the text belongs to the component's design, or, with
   * `heldExposureId`, the exposure feeding it is held by a lock the component
   * sets, whose row in the panel says why.
   */
  | {
      readonly kind: "part-of";
      readonly placementId: string;
      readonly heldExposureId?: string;
    };

/**
 * What the canvas may do with a value of a composed node, or `null` when the
 * node is the page's own and the ordinary inline edit answers for it.
 *
 * Text a `text` exposure feeds, and a passage a `richText` exposure feeds, on
 * an unlocked placement, are editable. Anything else in a component is "part
 * of" it: text it does not expose, a placement locked in Layers, and a value
 * the component's own locks hold (a block it locks in Layers, or a prop that
 * is not content inside an area locked to its content; the panel holds that
 * row read-only, with the reason).
 *
 * @param document - the page document, which holds the placement
 * @param composed - the editor's composition of it, with the exposure map
 * @param nodeId - the composed node's id, as the element carries it
 * @param prop - the prop the element renders
 * @param locks - the block definitions the editor judges locks by
 */
export function composedTextAt(
  document: BlockDocument,
  composed: BlockDocument | undefined,
  nodeId: string,
  prop: string,
  locks: SlotDefaultSource = registryBlockSource()
): ComposedTextAnswer | null {
  if (composed === undefined) return null;
  const found = placedNode(document, composed, nodeId);
  if (found === null) return null;
  const { node, placement } = found;
  const schema = getBlock(node.type)?.props?.[prop];
  const kind = inlinePropKind(schema);
  // Free text through a text exposure, a passage through a rich-text one: an
  // exposure of another type aimed at the prop is edited in the panel, where
  // its control keeps the value valid.
  const exposureId = exposureOf(
    document,
    node,
    prop,
    placement,
    kind === "rich" ? "richText" : "text"
  );
  // The judgement the panel's rows are held by, so the canvas offers exactly
  // the text the panel lets change.
  if (
    exposureId !== undefined &&
    composedHolds(composed, locks)(node, prop, false) !== undefined
  ) {
    return {
      kind: "part-of",
      placementId: placement.id,
      heldExposureId: exposureId,
    };
  }
  if (exposureId === undefined || kind === null) {
    return { kind: "part-of", placementId: placement.id };
  }
  if (kind === "rich") {
    return {
      kind: "exposed-rich",
      target: { nodeId, prop, placementId: placement.id, exposureId },
    };
  }
  // The text the page draws for this value, through the projection every
  // reader shares, so an untouched edit compares equal and writes nothing.
  const shown = authoredText(
    (node.props as Record<string, unknown> | undefined)?.[prop]
  );
  return {
    kind: "exposed",
    target: {
      nodeId,
      prop,
      placementId: placement.id,
      exposureId,
      multiline: schema?.type === "textarea",
      value: shown,
    },
  };
}

/**
 * The composed node and the page's placement it came from, or `null` when the
 * node is not one a placement contributed.
 */
function placedNode(
  document: BlockDocument,
  composed: BlockDocument,
  nodeId: string
): { node: ResolvedBlockNode; placement: BlockNode } | null {
  // Read as a composed node: the composition is the resolver's output, whose
  // nodes carry `instanceOf` and the exposure map.
  const node: ResolvedBlockNode | undefined = findNode(composed.nodes, nodeId);
  const placementId = node?.instanceOf;
  if (node === undefined || typeof placementId !== "string") return null;
  const placement = findNode(document.nodes, placementId);
  if (placement === undefined || !isComponentInstance(placement)) return null;
  return { node, placement };
}

/**
 * The id of the exposure of this type feeding this prop, when the placement
 * may change it.
 */
function exposureOf(
  document: BlockDocument,
  node: ResolvedBlockNode,
  prop: string,
  placement: BlockNode,
  type: "text" | "richText"
): string | undefined {
  const fed = node.exposedProps;
  const exposure =
    fed !== undefined && Object.hasOwn(fed, prop) ? fed[prop] : undefined;
  // The placement's Layers lock, its own or one around it: either holds every
  // value the placement stores.
  if (
    exposure?.type !== type ||
    lockBlockingEdit(document, placement.id) !== undefined
  ) {
    return undefined;
  }
  return exposure.id;
}

/**
 * The op that stores what the author typed as the placement's value, or
 * `null` when nothing changed or the placement is gone.
 *
 * An emptied value CLEARS the field (`$unset`), as the panel's field does:
 * the author took the text away, which inheriting would put back.
 */
export function exposedTextOp(
  document: BlockDocument,
  target: ExposedTextTarget,
  next: string
): BuilderOp | null {
  if (next === target.value) return null;
  const placement: BlockNode | undefined = findNode(
    document.nodes,
    target.placementId
  );
  if (
    placement === undefined ||
    lockBlockingEdit(document, placement.id) !== undefined
  ) {
    return null;
  }
  return setOverrideOp(
    placement,
    target.exposureId,
    next === "" ? { $unset: true } : next
  );
}

/**
 * The passage an exposed target shows now, raw as the composition holds it, or
 * `null` once it is no longer editable in place (the placement was locked or
 * removed, or the exposure stopped feeding it). Judged by
 * {@link composedTextAt}, the one answer the canvas opens a passage by, so the
 * editor closes on exactly the rules it opened on.
 */
export function exposedPassage(
  document: BlockDocument,
  composed: BlockDocument | undefined,
  target: ExposedRichTarget,
  locks: SlotDefaultSource = registryBlockSource()
): {
  readonly stored: unknown;
  readonly value: RichTextValue | undefined;
} | null {
  const answer = composedTextAt(
    document,
    composed,
    target.nodeId,
    target.prop,
    locks
  );
  if (
    answer?.kind !== "exposed-rich" ||
    answer.target.placementId !== target.placementId ||
    answer.target.exposureId !== target.exposureId ||
    composed === undefined
  ) {
    return null;
  }
  const node = findNode(composed.nodes, target.nodeId);
  const stored = node?.props?.[target.prop];
  return { stored, value: isRichTextValue(stored) ? stored : undefined };
}

/**
 * The op that stores an edited passage as the placement's value, or `null`
 * when there is nothing to write: the passage is unchanged, the editor did not
 * return a passage, it is no longer editable, or the page's copy changed while
 * it was open (the older copy is never written over the newer). One op, the
 * same the panel's field writes, so one undo step.
 *
 * @param next - what the editor read when the edit finished
 * @param before - what it read when the passage opened
 * @param opened - the raw passage the session was handed
 */
export function exposedRichOp(
  document: BlockDocument,
  composed: BlockDocument | undefined,
  target: ExposedRichTarget,
  next: unknown,
  before: unknown,
  opened: unknown,
  locks: SlotDefaultSource = registryBlockSource()
): BuilderOp | null {
  const now = exposedPassage(document, composed, target, locks);
  if (now === null || richTextChanged(opened, now.stored)) return null;
  if (!isRichTextValue(next) || !richTextChanged(before, next)) return null;
  const placement: BlockNode | undefined = findNode(
    document.nodes,
    target.placementId
  );
  if (placement === undefined) return null;
  return setOverrideOp(placement, target.exposureId, next);
}
