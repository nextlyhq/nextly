/**
 * Every placement break in a document, located, and the one an edit adds.
 *
 * Validation reports a placement break as an issue on a save. The editor needs
 * the same judgement on an edit, as data it can word and act on, so this visits
 * validation's own walk (`walkNodeForest`) with the same tracker, and the two
 * reach the same nodes under the same bounds.
 *
 * An edit is refused for a break it ADDS: a page stored before the rule still
 * opens, and an edit that leaves its breaks where they were is not the
 * author's to fix first. A break is the same one when its signature is
 * (`TrackedPlacement.signature`), which is what a save asks of the stored page.
 *
 * @module placement-breaks
 */
import type { BlockDocument, BlockNode } from "./document";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import {
  placementTracker,
  type PlacementRefused,
  type PlacementSources,
} from "./placement";
import { isPlainRecord } from "./plain-record";
import { storedBreakSignatures, walkNodeForest } from "./validation";

/** One node the placement rule refuses where it sits. */
export interface LocatedPlacementBreak {
  /** The node's id, as stored. */
  readonly id: string | undefined;
  /** Where it is, as a JSON pointer into the document. */
  readonly path: string;
  /** Its container's id, or undefined at the top level. */
  readonly parentId: string | undefined;
  /** The slot it sits in, or undefined at the top level. */
  readonly slot: string | undefined;
  readonly verdict: PlacementRefused;
  /** The break's identity across documents; see `TrackedPlacement`. */
  readonly signature: string;
}

/** Every placement break in a document, in the walk's breadth-first order. */
export function placementBreaksIn(
  document: BlockDocument,
  sources: PlacementSources,
  limits: DocumentLimits = DEFAULT_LIMITS
): LocatedPlacementBreak[] {
  const found: LocatedPlacementBreak[] = [];
  const nodes: unknown = isPlainRecord(document) ? document.nodes : undefined;
  if (!Array.isArray(nodes)) return found;
  const tracker = placementTracker(sources);
  walkNodeForest(
    nodes as BlockNode[],
    limits.maxNodes,
    { definitions: undefined, stored: undefined },
    ({ node, path, parent, slot }) => {
      const tracked = tracker.visit(node, parent, slot);
      if (tracked === undefined || tracked.verdict.allowed) return false;
      found.push({
        id:
          isPlainRecord(node) && typeof node.id === "string"
            ? node.id
            : undefined,
        path,
        parentId: typeof parent?.id === "string" ? parent.id : undefined,
        slot,
        verdict: tracked.verdict,
        signature: tracked.signature,
      });
      return false;
    }
  );
  return found;
}

/**
 * The first placement break `after` holds that `before` did not, or undefined
 * when the edit added none.
 *
 * `after` is walked first, and alone when it holds no break at all, which is
 * the document an edit usually leaves; `before` is read only to tell an old
 * break from a new one.
 */
export function placementRefusal(
  before: BlockDocument,
  after: BlockDocument,
  sources: PlacementSources,
  limits: DocumentLimits = DEFAULT_LIMITS
): LocatedPlacementBreak | undefined {
  const breaks = placementBreaksIn(after, sources, limits);
  if (breaks.length === 0) return undefined;
  const old = storedBreakSignatures([before], sources, limits.maxNodes);
  return breaks.find(found => !old.has(found.signature));
}
