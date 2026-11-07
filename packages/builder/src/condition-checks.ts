/**
 * Which blocks' visibility conditions the page can't check: the ones the
 * engine finds a problem with, judged as a save judges them, and the ones
 * stored in a shape no condition row can show. Visitors never see such a
 * block, so the editor says so wherever it draws one: the inspector's notice
 * and the canvas's red badge read this one answer.
 *
 * @module condition-checks
 */
import {
  conditionIssues,
  DEFAULT_LIMITS,
  placementGatesOf,
  revealConditioned,
  resolveComponentInstances,
  isPlainRecord,
  walkNodes,
  type BlockDocument,
  type BlockNode,
  type Condition,
  type DefinitionsById,
  type DocumentLimits,
  type NodeVisibility,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { useLoopCollections } from "./collection-loop-controls";
import { asStoredDefinitions, gatedAsStored } from "./condition-gate";
import type { ContentServices, LoopCollection } from "./content-controls";
import { fieldSourceOf } from "./list-query-controls";

/** Whether a stored value is a condition a row can show: a field and an operator. */
function isConditionRecord(value: unknown): value is Condition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const { field, op } = value as { field?: unknown; op?: unknown };
  return typeof field === "string" && typeof op === "string";
}

/**
 * The stored groups, an OR of AND groups of conditions; none when nothing is
 * stored, and `undefined` for a shape no row can show, such as a flat list of
 * conditions or a group holding something else. The engine hides a block
 * whose conditions it can't read, and says why.
 */
export function storedGroups(
  node: BlockNode
): readonly (readonly Condition[])[] | undefined {
  const envelope: unknown = node.visibility;
  if (envelope === undefined || envelope === null) return [];
  // A visibility that is not a record, a string or a list, is one the engine
  // reads as a restriction it can't check.
  if (!isPlainRecord(envelope)) return undefined;
  const groups: unknown = envelope.conditions;
  if (groups === undefined) return [];
  // Stored as `null`, which the save refuses as malformed although the page
  // reads it as no restriction: offered for removal, as any shape no row can
  // show is.
  if (groups === null) return undefined;
  if (!Array.isArray(groups)) return undefined;
  const read: Condition[][] = [];
  for (const group of groups as unknown[]) {
    // Every position read, holes included: `every` skips a hole, which would
    // reach the rows as a condition that isn't there.
    if (!Array.isArray(group) || !Array.from(group).every(isConditionRecord)) {
      return undefined;
    }
    read.push(group);
  }
  return read;
}

/**
 * The blocks in a forest whose conditions the page can't check. A problem
 * that needs the collections' fields is judged once they are listed, so a
 * block isn't marked while they load. If they can't be listed, what needs no
 * fields is still judged (an operator conditions don't have, an entry a
 * Single's page doesn't have). One stored in a shape no row can show needs no
 * fields and is always marked. Read as far as `maxNodes`, the limit a save
 * surveys a document to.
 */
export function uncheckedConditionIds(
  nodes: readonly BlockNode[],
  collections: readonly LoopCollection[] | "loading" | "unavailable",
  entryCollection: string | null | undefined,
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): ReadonlySet<string> {
  const found = new Set<string>();
  // The engine's guarded walk, which tolerates a malformed entry and a tree
  // deeper than a call stack, as a stored document may be, and stops where a
  // save stops surveying.
  walkNodes(
    [...nodes],
    node => {
      if (gatedAsStored(node) && storedGroups(node) === undefined) {
        found.add(node.id);
      }
    },
    { maxNodes }
  );
  if (collections === "loading") return found;
  for (const issue of conditionIssues(nodes, {
    ...(collections === "unavailable"
      ? {}
      : { fields: fieldSourceOf(collections) }),
    // As far as a save surveys a document, and no further.
    maxNodes,
    ...(entryCollection === undefined ? {} : { entryCollection }),
  })) {
    if (issue.severity === "error") found.add(issue.nodeId);
  }
  return found;
}

/**
 * A composed tree once for each depth of placement gates it carries. In the
 * k-th, a block carrying more than k gates holds the k-th as its own
 * visibility and every other block holds none, so each gate a placement
 * nested in a component put on a block is judged as conditions are, where
 * the block is drawn, inside the lists around it, and by the id the canvas
 * draws it with.
 */
function placementGatePasses(nodes: readonly BlockNode[]): BlockNode[][] {
  const passes: BlockNode[][] = [];
  for (let depth = 0; ; depth += 1) {
    const found = { any: false };
    const pass = withGateAt(nodes, depth, found);
    if (!found.any) return passes;
    passes.push(pass);
  }
}

/** A forest with each block's `depth`-th placement gate as its visibility. */
function withGateAt(
  nodes: readonly BlockNode[],
  depth: number,
  found: { any: boolean }
): BlockNode[] {
  return nodes.map(node => {
    const gate = isPlainRecord(node.visibility)
      ? placementGatesOf(node.visibility)[depth]
      : undefined;
    const next: BlockNode = { ...node };
    if (gate === undefined) {
      delete next.visibility;
    } else {
      found.any = true;
      // As the placement stored it, an unreadable one included, which the
      // judgement marks as it marks one stored on a block.
      next.visibility = gate as NodeVisibility;
    }
    if (isPlainRecord(node.slots)) {
      const slots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(node.slots)) {
        if (Array.isArray(children)) {
          slots[name] = withGateAt(children, depth, found);
        }
      }
      next.slots = slots;
    }
    return next;
  });
}

/**
 * {@link uncheckedConditionIds} for a document, as an editor's services list
 * the collections: its own blocks, and with `definitions` the blocks its
 * placed components hold too, judged in the tree composed as the canvas
 * draws it, by the ids the canvas draws them with.
 */
export function useConditionsUnchecked(
  document: BlockDocument,
  services:
    | Pick<ContentServices, "listLoopCollections" | "entryCollection">
    | undefined,
  /** The document limits the host renders and saves under. */
  limits?: DocumentLimits,
  /** The definitions of the components the document places. */
  definitions?: DefinitionsById
): ReadonlySet<string> {
  const listed = useLoopCollections(services?.listLoopCollections);
  const collections =
    listed === undefined || listed.kind === "failed"
      ? "unavailable"
      : listed.kind === "loading"
        ? "loading"
        : listed.collections;
  const entryCollection = services?.entryCollection;
  const maxNodes = limits?.maxNodes;
  return React.useMemo(() => {
    const own = uncheckedConditionIds(
      document.nodes,
      collections,
      entryCollection,
      maxNodes
    );
    if (definitions === undefined || definitions.size === 0) return own;
    // The page's own conditions lifted, as the canvas composes it, so a
    // composed block holds only what its definition gave it.
    const composed = resolveComponentInstances(
      revealConditioned(document),
      asStoredDefinitions(definitions, limits),
      {
        conditioned: "carry",
        // Every limit the canvas composes under, so a site that raises the
        // depth has its deeper blocks judged as they are drawn.
        ...(limits === undefined ? {} : { limits }),
      }
    ).document;
    const judged = (nodes: readonly BlockNode[]) => [
      ...uncheckedConditionIds(nodes, collections, entryCollection, maxNodes),
    ];
    return new Set([
      ...own,
      ...judged(composed.nodes),
      // And each gate a placement nested in a component put on its roots.
      ...placementGatePasses(composed.nodes).flatMap(judged),
    ]);
  }, [document, collections, entryCollection, maxNodes, limits, definitions]);
}
