/**
 * The blocks a component locks in Layers, as a page placing it composes them.
 *
 * A page reaches into a component only through a placement: a value for an
 * exposed field, and content for an exposed slot. Both land inside the
 * component's own nodes, which only the composed page shows, so a page whose
 * own document holds no lock can still change a block its component locks.
 *
 * One judgement for every place that asks: the save measures a written page
 * with {@link placedLockChanges}, and the editor holds an exposed field or
 * refuses an edit with the same coverage ({@link componentLayersLocks}) and
 * the same comparison, so what the editor offers is what a save accepts.
 *
 * @module component-layers-locks
 */
import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { layersLockChanges, type LayersLockChange } from "./layers-lock-stored";
import type { DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";
import { walkNodes } from "./tree";

/** The lock a component holds a composed node under. */
export interface ComponentLayersLock {
  /** The composed block the component locks: the node itself, or one around it. */
  readonly holderId: string;
  /** The page's placement the node is composed for. */
  readonly placementId: string;
}

/** Whether a composed node is one a definition put there, locked in Layers. */
function isPlacedLock(node: BlockNode): boolean {
  const own = node as unknown as Readonly<Record<string, unknown>>;
  return typeof own.instanceOf === "string" && own.locked === true;
}

/** The nodes of a value read as a forest, or none. */
function nodesOf(form: unknown): BlockNode[] {
  const nodes = isPlainRecord(form) ? form.nodes : undefined;
  return Array.isArray(nodes) ? (nodes as BlockNode[]) : [];
}

/**
 * Every composed node a component's Layers lock covers, by id: a block the
 * component locks, and everything inside it, the placement's own slot content
 * included, which changes what the lock holds as much as a value does. A lock
 * the page sets on its own block is the page's, judged against the stored
 * page, and is not reported here.
 *
 * @param nodes - a composition's nodes, as the resolver returns them
 * @param limits - bounds the walk, as every walk of a document is bounded
 */
export function componentLayersLocks(
  nodes: readonly BlockNode[],
  limits?: Pick<DocumentLimits, "maxNodes">
): Map<string, ComponentLayersLock> {
  const covered = new Map<string, ComponentLayersLock>();
  walkNodes(
    [...nodes],
    (node, parent) => {
      const around = parent === undefined ? undefined : covered.get(parent.id);
      if (around !== undefined) {
        covered.set(node.id, around);
        return;
      }
      if (!isPlacedLock(node)) return;
      const placementId = (node as { instanceOf?: unknown }).instanceOf;
      covered.set(node.id, {
        holderId: node.id,
        placementId: String(placementId),
      });
    },
    limits === undefined ? {} : { maxNodes: limits.maxNodes }
  );
  return covered;
}

/**
 * The document with each placement's own values, its chosen variant and its
 * slot content removed, so composing it draws every component as the
 * component holds it: the baseline a placement's values are measured against.
 * A variant is a placement's choice too, and one that changes a locked block
 * changes it as a value would.
 */
export function placementsAsComponentsHoldThem(
  document: BlockDocument,
  limits: Pick<DocumentLimits, "maxNodes">
): BlockDocument {
  const copy = structuredClone(document);
  walkNodes(
    copy.nodes,
    node => {
      if (node.type !== COMPONENT_INSTANCE_TYPE) return;
      const own = node as unknown as Record<string, unknown>;
      const props = own.props;
      if (typeof props === "object" && props !== null) {
        delete (props as Record<string, unknown>).overrides;
        delete (props as Record<string, unknown>).variant;
      }
      delete own.slots;
    },
    { maxNodes: limits.maxNodes }
  );
  return copy;
}

/**
 * A composed document with only the components' locks kept. A lock the page
 * sets on its own block is judged against the stored page elsewhere; measured
 * here too, against a baseline whose placements carry no values, it would read
 * every value given inside it as a change.
 */
function placedLocksOnly(
  form: unknown,
  limits: Pick<DocumentLimits, "maxNodes">
): unknown {
  if (nodesOf(form).length === 0) return form;
  const copy = structuredClone(form as BlockDocument);
  walkNodes(
    copy.nodes,
    node => {
      if (!isPlacedLock(node)) delete (node as { locked?: unknown }).locked;
    },
    { maxNodes: limits.maxNodes }
  );
  return copy;
}

/** A kept form, read once: its nodes without page locks, and what it holds. */
interface KeptForm {
  readonly form: unknown;
  /** The blocks its components lock, by id. */
  readonly locked: ReadonlySet<string>;
  /** Every composed node's id it holds. */
  readonly ids: ReadonlySet<string>;
  /** The placements it composes, by the instance their nodes name. */
  readonly placements: ReadonlySet<string>;
}

/** One kept form, read for {@link keptBy}. */
function keptFormOf(
  form: unknown,
  limits: Pick<DocumentLimits, "maxNodes">
): KeptForm {
  const ids = new Set<string>();
  const placements = new Set<string>();
  walkNodes(
    nodesOf(form),
    node => {
      ids.add(node.id);
      const owner = (node as { instanceOf?: unknown }).instanceOf;
      if (typeof owner === "string") placements.add(owner);
    },
    { maxNodes: limits.maxNodes }
  );
  return {
    form: placedLocksOnly(form, limits),
    locked: new Set(
      [...componentLayersLocks(nodesOf(form), limits)].flatMap(([id, lock]) =>
        lock.holderId === id ? [id] : []
      )
    ),
    ids,
    placements,
  };
}

/**
 * Whether one of `kept` already gave the locked block what the composed page
 * gives it: that form holds it locked by its component, and the page leaves
 * it as the form holds it; or, for a block the page no longer draws, that
 * form composes the same placement and does not draw it either, as when a
 * variant chosen before already hid it.
 */
function keptBy(
  change: LayersLockChange,
  composed: unknown,
  kept: readonly KeptForm[],
  placementOf: (id: string) => string | undefined
): boolean {
  if (change.kind === "removed") {
    const placement = placementOf(change.id);
    if (
      placement !== undefined &&
      kept.some(
        form => form.placements.has(placement) && !form.ids.has(change.id)
      )
    ) {
      return true;
    }
  }
  return kept.some(
    ({ form, locked }) =>
      locked.has(change.id) &&
      !layersLockChanges(composed, form).some(held => held.id === change.id)
  );
}

/**
 * Each block a placed component locks that the composed page changes, moves
 * or removes through its placements, outermost first.
 *
 * @param composed - the page as written, composed
 * @param asHeld - the same page with every placement as its component holds
 *   it ({@link placementsAsComponentsHoldThem}), composed
 * @param kept - composed forms whose values a block may keep: a value one of
 *   them already gives a locked block is no change, so a block locked after
 *   pages gave it values does not make them unsavable
 */
export function placedLockChanges(
  composed: unknown,
  asHeld: unknown,
  kept: readonly unknown[],
  limits: Pick<DocumentLimits, "maxNodes">
): LayersLockChange[] {
  const found = layersLockChanges(composed, placedLocksOnly(asHeld, limits));
  if (found.length === 0) return [];
  const forms = kept.map(form => keptFormOf(form, limits));
  const held = componentLayersLocks(nodesOf(asHeld), limits);
  return found.filter(
    change => !keptBy(change, composed, forms, id => held.get(id)?.placementId)
  );
}
