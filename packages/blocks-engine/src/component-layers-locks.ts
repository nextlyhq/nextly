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
import { removeNode, walkNodes } from "./tree";

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
 * A page with the placements of one nesting level as their components hold
 * them, and the placements that level holds.
 */
export interface HeldBaseline {
  readonly document: BlockDocument;
  /** The ids of the placements drawn as held: the level's own. */
  readonly placements: ReadonlySet<string>;
}

/**
 * The page with each placement `level` slots deep (0: not inside another
 * placement's slot) stripped of its own values, its chosen variant and its
 * slot content, and everything shallower left as the page gives it. A variant
 * is a placement's choice too, and one that changes a locked block changes it
 * as a value would. The slot content goes because a component's lock covers
 * what a page puts inside the locked block; a placement in that content is
 * measured at the next level, inside its host as the page composes it.
 */
function heldAtLevel(
  document: BlockDocument,
  level: number,
  limits: Pick<DocumentLimits, "maxNodes">
): HeldBaseline {
  const copy = structuredClone(document);
  const placements = new Set<string>();
  // Iterative, and bounded by the node count, as every walk of a document is.
  const pending: Array<{ nodes: BlockNode[]; depth: number }> = [
    { nodes: copy.nodes, depth: 0 },
  ];
  let budget = limits.maxNodes;
  for (
    let next = pending.pop();
    next !== undefined && budget > 0;
    next = pending.pop()
  ) {
    budget -= next.nodes.length;
    for (const node of next.nodes) {
      const placed = node.type === COMPONENT_INSTANCE_TYPE;
      if (placed && next.depth === level) {
        placements.add(node.id);
        holdAsItsComponent(node);
        continue;
      }
      const depth = placed ? next.depth + 1 : next.depth;
      for (const children of Object.values(node.slots ?? {})) {
        pending.push({ nodes: children, depth });
      }
    }
  }
  return { document: copy, placements };
}

/** A placement stripped of its own values, its variant and its slot content. */
function holdAsItsComponent(node: BlockNode): void {
  const own = node as unknown as Record<string, unknown>;
  if (isPlainRecord(own.props)) {
    delete own.props.overrides;
    delete own.props.variant;
  }
  delete own.slots;
}

/**
 * The page with every placement not inside another's slot as its component
 * holds it: the baseline a page's own lock baselines start from.
 */
export function placementsAsComponentsHoldThem(
  document: BlockDocument,
  limits: Pick<DocumentLimits, "maxNodes">
): BlockDocument {
  return heldAtLevel(document, 0, limits).document;
}

/**
 * One held baseline per nesting level the page places components at,
 * outermost first, for {@link placedLockChanges} once each is composed. A
 * component placed inside another's slot is held at its own level, so its
 * locks are measured too, where the outer level's baseline drops it with the
 * slot content.
 */
export function heldBaselines(
  document: BlockDocument,
  limits: Pick<DocumentLimits, "maxNodes">
): HeldBaseline[] {
  const levels: HeldBaseline[] = [];
  for (let level = 0; ; level++) {
    const held = heldAtLevel(document, level, limits);
    if (held.placements.size === 0) return levels;
    levels.push(held);
  }
}

/**
 * A kept form with any placement the page now draws from another component
 * removed. Composed nodes are named by placement, not by component, so a
 * placement switched to a component whose locked block shares an id would
 * otherwise keep the first component's value under the second's lock. The
 * form itself when nothing was switched.
 */
export function keptForSameComponents(
  document: BlockDocument,
  kept: BlockDocument,
  limits: Pick<DocumentLimits, "maxNodes">
): BlockDocument {
  const drawn = new Map<string, unknown>();
  walkNodes(
    document.nodes,
    node => {
      if (node.type === COMPONENT_INSTANCE_TYPE) {
        drawn.set(node.id, componentIdOf(node));
      }
    },
    { maxNodes: limits.maxNodes }
  );
  const switched: string[] = [];
  walkNodes(
    kept.nodes,
    node => {
      if (
        node.type === COMPONENT_INSTANCE_TYPE &&
        drawn.has(node.id) &&
        drawn.get(node.id) !== componentIdOf(node)
      ) {
        switched.push(node.id);
      }
    },
    { maxNodes: limits.maxNodes }
  );
  if (switched.length === 0) return kept;
  return {
    ...kept,
    nodes: switched.reduce((nodes, id) => removeNode(nodes, id), kept.nodes),
  };
}

/** The component a placement draws, as its props name it. */
function componentIdOf(node: BlockNode): unknown {
  return isPlainRecord(node.props) ? node.props.componentId : undefined;
}

/**
 * A composed document with only the locks of the given placements'
 * components kept. A lock the page sets on its own block is judged against
 * the stored page elsewhere; measured here too, against a baseline whose
 * placements carry no values, it would read every value given inside it as a
 * change. So would a lock of a shallower placement, whose slot content a
 * deeper level's baseline leaves holding the page's values.
 */
function placedLocksOnly(
  form: unknown,
  limits: Pick<DocumentLimits, "maxNodes">,
  placements?: ReadonlySet<string>
): unknown {
  if (nodesOf(form).length === 0) return form;
  const copy = structuredClone(form as BlockDocument);
  walkNodes(
    copy.nodes,
    node => {
      const kept =
        isPlacedLock(node) &&
        (placements === undefined ||
          placements.has(
            String((node as { instanceOf?: unknown }).instanceOf)
          ));
      if (!kept) delete (node as { locked?: unknown }).locked;
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
  placement: string | undefined
): boolean {
  if (change.kind === "removed") {
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

/** A held baseline composed: the form, and the placements it holds. */
export interface ComposedHeldBaseline {
  readonly form: unknown;
  readonly placements: ReadonlySet<string>;
}

/** A block a placed component locks, changed, and the placement it is drawn for. */
export interface PlacedLockChange extends LayersLockChange {
  readonly placementId: string | undefined;
}

/**
 * Each block a placed component locks that the composed page changes, moves
 * or removes through its placements, outermost level first.
 *
 * @param composed - the page as written, composed
 * @param held - each of {@link heldBaselines}, composed: a level's locks are
 *   measured against its own baseline only
 * @param kept - composed forms whose values a block may keep: a value one of
 *   them already gives a locked block is no change, so a block locked after
 *   pages gave it values does not make them unsavable. Each is read with
 *   {@link keptForSameComponents} before it is composed.
 */
export function placedLockChanges(
  composed: unknown,
  held: readonly ComposedHeldBaseline[],
  kept: readonly unknown[],
  limits: Pick<DocumentLimits, "maxNodes">
): PlacedLockChange[] {
  let forms: KeptForm[] | undefined;
  const changes: PlacedLockChange[] = [];
  for (const level of held) {
    const found = layersLockChanges(
      composed,
      placedLocksOnly(level.form, limits, level.placements)
    );
    if (found.length === 0) continue;
    forms ??= kept.map(form => keptFormOf(form, limits));
    const locks = componentLayersLocks(nodesOf(level.form), limits);
    for (const change of found) {
      const placementId = locks.get(change.id)?.placementId;
      if (!keptBy(change, composed, forms, placementId)) {
        changes.push({ ...change, placementId });
      }
    }
  }
  return changes;
}
