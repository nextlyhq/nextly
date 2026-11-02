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
  findNode,
  getBlock,
  isComponentInstance,
  type BlockDocument,
  type BlockNode,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";

import { inlinePropKind } from "./inline-prop-kind";
import { setOverrideOp } from "./instance-inspector";
import { isLocked } from "./locking";
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
  /** Not editable here: the text belongs to the component's design. */
  | { readonly kind: "part-of"; readonly placementId: string };

/**
 * What the canvas may do with a value of a composed node, or `null` when the
 * node is the page's own and the ordinary inline edit answers for it.
 *
 * Exposed plain text on an unlocked placement is editable. Anything else in a
 * component is "part of" it: text it does not expose, a placement locked in
 * Layers, and rich text, which has no inline editor for a placement yet.
 *
 * @param document - the page document, which holds the placement
 * @param composed - the editor's composition of it, with the exposure map
 * @param nodeId - the composed node's id, as the element carries it
 * @param prop - the prop the element renders
 */
export function composedTextAt(
  document: BlockDocument,
  composed: BlockDocument | undefined,
  nodeId: string,
  prop: string
): ComposedTextAnswer | null {
  if (composed === undefined) return null;
  const node = findNode(composed.nodes, nodeId);
  const placementId = node?.instanceOf;
  if (node === undefined || typeof placementId !== "string") return null;
  const placement = findNode(document.nodes, placementId);
  if (placement === undefined || !isComponentInstance(placement)) return null;

  const partOf: ComposedTextAnswer = { kind: "part-of", placementId };
  const fed = node.exposedProps;
  const exposureId =
    fed !== undefined && Object.hasOwn(fed, prop) ? fed[prop] : undefined;
  if (typeof exposureId !== "string" || isLocked(placement)) return partOf;
  const schema = getBlock(node.type)?.props?.[prop];
  if (inlinePropKind(schema) !== "plain") return partOf;
  const shown: unknown = (node.props as Record<string, unknown> | undefined)?.[
    prop
  ];
  return {
    kind: "exposed",
    target: {
      nodeId,
      prop,
      placementId,
      exposureId,
      multiline: schema?.type === "textarea",
      value: typeof shown === "string" ? shown : "",
    },
  };
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
  if (placement === undefined || isLocked(placement)) return null;
  return setOverrideOp(
    placement,
    target.exposureId,
    next === "" ? { $unset: true } : next
  );
}
