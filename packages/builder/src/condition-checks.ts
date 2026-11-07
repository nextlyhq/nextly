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
  isPlainRecord,
  walkNodes,
  type BlockDocument,
  type BlockNode,
  type Condition,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { useLoopCollections } from "./collection-loop-controls";
import type { ContentServices, LoopCollection } from "./content-controls";
import { gatedAsStored } from "./condition-gate";
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
  if (groups === undefined || groups === null) return [];
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
 * that needs the collections' fields is judged only once they are listed,
 * so a block isn't marked while they load; one stored in a shape no row can
 * show needs no fields and is always marked.
 */
export function uncheckedConditionIds(
  nodes: readonly BlockNode[],
  collections: readonly LoopCollection[] | undefined,
  entryCollection: string | null | undefined
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
    { maxNodes: DEFAULT_LIMITS.maxNodes }
  );
  if (collections === undefined) return found;
  for (const issue of conditionIssues(nodes, {
    fields: fieldSourceOf(collections),
    // As far as a save surveys a document, and no further.
    maxNodes: DEFAULT_LIMITS.maxNodes,
    ...(entryCollection === undefined ? {} : { entryCollection }),
  })) {
    if (issue.severity === "error") found.add(issue.nodeId);
  }
  return found;
}

/** {@link uncheckedConditionIds} for a document, as an editor's services list the collections. */
export function useConditionsUnchecked(
  document: BlockDocument,
  services:
    | Pick<ContentServices, "listLoopCollections" | "entryCollection">
    | undefined
): ReadonlySet<string> {
  const listed = useLoopCollections(services?.listLoopCollections);
  const collections = listed?.kind === "ready" ? listed.collections : undefined;
  const entryCollection = services?.entryCollection;
  return React.useMemo(
    () => uncheckedConditionIds(document.nodes, collections, entryCollection),
    [document, collections, entryCollection]
  );
}
