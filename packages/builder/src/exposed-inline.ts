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
  registryBlockSource,
  type BlockDocument,
  type BlockNode,
  type ResolvedBlockNode,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import { composedHolds } from "./component-holds";
import { inlinePropKind } from "./inline-prop-kind";
import { setOverrideOp } from "./instance-inspector";
import { lockBlockingEdit } from "./locking";
import type { BuilderOp } from "./ops";

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

/** What a double-click on a component's text means. */
export type ComposedTextAnswer =
  | { readonly kind: "exposed"; readonly target: ExposedTextTarget }
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
 * Text a `text` exposure feeds, on an unlocked placement, is editable. Anything else in a
 * component is "part of" it: text it does not expose, a placement locked in
 * Layers, a value the component's own locks hold (a block it locks in Layers,
 * or a prop that is not content inside an area locked to its content; the
 * panel holds that row read-only, with the reason), and rich text, which has
 * no inline editor for a placement yet.
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
  const exposureId = textExposureOf(document, node, prop, placement);
  const schema = getBlock(node.type)?.props?.[prop];
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
  if (exposureId === undefined || inlinePropKind(schema) !== "plain") {
    return { kind: "part-of", placementId: placement.id };
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
 * The id of the `text` exposure feeding this prop, when the placement may
 * change it. Free text only through a text exposure: a choice or a link aimed
 * at a text prop is edited in the panel, where its control keeps it valid.
 */
function textExposureOf(
  document: BlockDocument,
  node: ResolvedBlockNode,
  prop: string,
  placement: BlockNode
): string | undefined {
  const fed = node.exposedProps;
  const exposure =
    fed !== undefined && Object.hasOwn(fed, prop) ? fed[prop] : undefined;
  // The placement's Layers lock, its own or one around it: either holds every
  // value the placement stores.
  if (
    exposure?.type !== "text" ||
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
