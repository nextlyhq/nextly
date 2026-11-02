/**
 * The fields a designer removed from a component, and taking their values out
 * of the documents that place it.
 *
 * Removing an exposed field RETIRES its id: it is never minted again, and no
 * placement value under it may survive. The retired list is bookkeeping kept
 * by whoever stores components, not part of the component's envelope, so the
 * published document format is unchanged; this module takes it as an input.
 *
 * Every placement of a component stores its values keyed by exposure id, in
 * whatever document holds it: a page, a Single, another component, a pattern.
 * {@link stripRetiredExposures} is the one rule for taking a retired id's value
 * out of such a document, so a page write, a cleanup pass and an import cannot
 * each decide differently what "removed" leaves behind.
 *
 * @module retired-exposures
 */
import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { isDescendable, walkForest } from "./forest-walk";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys } from "./safe-record";

/**
 * The ids one component has retired.
 *
 * Two lists because they are two namespaces: a placement keys its field values
 * by exposure id in `props.overrides`, and its slot content by exposed slot id
 * in its own `slots`. A field and a slot may share a spelling.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface RetiredExposures {
  readonly properties: readonly string[];
  readonly slots: readonly string[];
}

/**
 * Each component's retired ids, by component id.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export type RetiredByComponent = ReadonlyMap<string, RetiredExposures>;

/**
 * A document with every retired value taken out, and how many there were.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface StrippedDocument<TDocument extends BlockDocument> {
  /**
   * The SAME object that was passed in when {@link removed} is 0, so a caller
   * can tell an unchanged document by identity and skip the write.
   */
  readonly document: TDocument;
  /** Field values plus slot contents removed, over every placement. */
  readonly removed: number;
}

/**
 * Take every retired field value and retired slot's content out of the
 * placements a document holds.
 *
 * Only the placements of the component that retired the id are touched: an id
 * is scoped to its own component, so another component's placement holding a
 * value under the same spelling keeps it. Placements nested in a container's
 * slot or in another placement's slot content are reached, since a value
 * there renders as surely as one at the top.
 *
 * An `overrides` record the strip empties is dropped, because an empty record
 * and no record mean the same thing, and a page that differs only in that is a
 * write nobody needed. Idempotent: a second pass finds nothing and hands the
 * document back unchanged.
 *
 * The document passed in is never changed. The walk runs twice when there is
 * something to remove, once to find out and once over a copy, so the common
 * case, a write with nothing retired in it, costs no copy.
 *
 * Bounded by the HOST's node cap, the one its document gate accepts, so a site
 * that raised it has every placement it stores reached: a placement past a
 * smaller bound would keep a value its designer confirmed removed.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function stripRetiredExposures<TDocument extends BlockDocument>(
  document: TDocument,
  retired: RetiredByComponent,
  limits: DocumentLimits = DEFAULT_LIMITS
): StrippedDocument<TDocument> {
  if (retired.size === 0 || !Array.isArray(document.nodes)) {
    return { document, removed: 0 };
  }
  const maxNodes = limits.maxNodes;
  const found = stripForest(document.nodes, retired, maxNodes, false);
  if (found === 0) return { document, removed: 0 };

  const copy = structuredClone(document);
  return {
    document: copy,
    removed: stripForest(copy.nodes, retired, maxNodes, true),
  };
}

/**
 * Count, and when `apply` is set also remove, the retired values in a forest.
 *
 * Bounded by the host's node cap, as every walk over stored input is.
 */
function stripForest(
  nodes: readonly unknown[],
  retired: RetiredByComponent,
  maxNodes: number,
  apply: boolean
): number {
  let removed = 0;
  let seen = 0;
  walkForest(nodes, ({ node, cycle }) => {
    seen += 1;
    if (seen > maxNodes) return "stop";
    if (cycle || !isDescendable(node)) return "skip";
    removed += stripPlacement(node, retired, apply);
    return "descend";
  });
  return removed;
}

/** One node's retired values, when it is a placement of a retiring component. */
function stripPlacement(
  node: BlockNode,
  retired: RetiredByComponent,
  apply: boolean
): number {
  if (node.type !== COMPONENT_INSTANCE_TYPE || !isPlainRecord(node.props)) {
    return 0;
  }
  const componentId = node.props.componentId;
  if (typeof componentId !== "string") return 0;
  const ids = retired.get(componentId);
  if (ids === undefined) return 0;

  let removed = 0;
  const overrides = node.props.overrides;
  if (isPlainRecord(overrides)) {
    removed += removeKeys(overrides, ids.properties, apply);
    // A limit of 0 answers `[]` only for a record with no own key left.
    if (apply && boundedOwnKeys(overrides, 0) !== null) {
      delete node.props.overrides;
    }
  }
  // The walk has not yet descended into this node's slots, so content removed
  // here is never visited: a placement inside retired content goes with it.
  if (isPlainRecord(node.slots)) {
    removed += removeKeys(node.slots, ids.slots, apply);
  }
  return removed;
}

/**
 * Remove the named own keys of a record; returns how many it held.
 *
 * Every key is asked: a component's retired list only grows and lives outside
 * its bounded envelope, so a cap here would keep the values of every field
 * retired past it. Each key costs one own-property check.
 */
function removeKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  apply: boolean
): number {
  let removed = 0;
  for (const key of keys) {
    // Own keys only: a stored record may hold `__proto__` or `toString` as a
    // key, and `in` would find an inherited one on every record.
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    removed += 1;
    if (apply) delete record[key];
  }
  return removed;
}
