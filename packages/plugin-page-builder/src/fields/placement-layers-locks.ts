/**
 * A block a placed component locks in Layers, held against what the page gives
 * its placement.
 *
 * A page reaches into a component only through a placement: a value for an
 * exposed field, and content for an exposed slot. Both land inside the
 * component's own nodes, which only the composed page shows, so a page whose
 * own document holds no lock can still change a block its component locks.
 * This reads the composition the field's composition check has already
 * resolved, and measures each locked node a definition put there against the
 * same page with every placement as its component holds it, the baseline a
 * `"contentOnly"` lock is measured against (`lockBaselines`). The engine's
 * `layersLockChanges` decides what counts as a change, as it does for a block
 * the page locks itself; the page cannot unlock a component's block, so no
 * write is let past by unlocking.
 *
 * A value the stored page already gives the block is kept, as a slot lock
 * keeps one: a block locked after pages gave it values does not make every
 * one of them unsavable, and only a new value is refused.
 *
 * @module fields/placement-layers-locks
 */
import {
  isConditionGated,
  layersLockChanges,
  walkNodes,
  type BlockDocument,
  type BlockNode,
  type DocumentLimits,
  type LayersLockChange,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";

import {
  composeWithReads,
  type BoundedReader,
  type HeldLibrary,
} from "../composition-reading";

import {
  composedFormsRead,
  placementsAsComponentsHoldThem,
} from "./lock-baselines";

/** What judging a page's placed locks found. */
export type PlacedLocksAnswer =
  /** Each locked block the write changes, moves or removes; often none. */
  | { readonly kind: "judged"; readonly changes: readonly LayersLockChange[] }
  /** The save's composition allowance ran out before the baseline composed. */
  | { readonly kind: "unchecked" }
  /** The stored page could not be read, so an old value can't be told apart. */
  | { readonly kind: "unjudged" };

const NONE: PlacedLocksAnswer = { kind: "judged", changes: [] };

/** Whether a composed node is one a definition put there, locked in Layers. */
function isPlacedLock(node: BlockNode): boolean {
  const own = node as unknown as Readonly<Record<string, unknown>>;
  return typeof own.instanceOf === "string" && own.locked === true;
}

/**
 * A composed document with only the components' locks kept. A lock the page
 * sets on its own block is judged against the stored page by the field's own
 * validation; measured here too, against a baseline whose placements carry no
 * values, it would read every value given inside it as a change.
 */
function placedLocksOnly(form: unknown, limits: DocumentLimits): unknown {
  const nodes = (form as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return form;
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

/**
 * The document with every gate a condition puts on its own blocks lifted, or
 * `undefined` when it holds none. The composition leaves a gated placement,
 * and every placement inside a gated block, standing unexpanded, since no
 * reader is served it; but its values are stored, and served once the
 * condition lifts, so its component's locks hold on them all the same.
 */
function withGatesLifted(
  document: BlockDocument,
  limits: DocumentLimits
): BlockDocument | undefined {
  const bound = { maxNodes: limits.maxNodes };
  // Asked of the document first: most pages gate no block, and then nothing
  // is cloned.
  let gated = false;
  walkNodes(
    document.nodes,
    node => {
      if (isConditionGated(node)) gated = true;
    },
    bound
  );
  if (!gated) return undefined;
  const copy = structuredClone(document);
  walkNodes(
    copy.nodes,
    node => {
      if (isConditionGated(node)) {
        delete (node as { visibility?: unknown }).visibility;
      }
    },
    bound
  );
  return copy;
}

/** The ids of the blocks a composed form holds that a component locks. */
function placedLockIds(form: unknown, limits: DocumentLimits): Set<string> {
  const ids = new Set<string>();
  const nodes = (form as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return ids;
  walkNodes(
    nodes as BlockNode[],
    node => {
      if (isPlacedLock(node)) ids.add(node.id);
    },
    { maxNodes: limits.maxNodes }
  );
  return ids;
}

/**
 * Whether a stored form already gave the locked block what the write gives
 * it: the form holds it locked, and the write leaves it as the form holds it.
 */
function keptBy(
  change: LayersLockChange,
  composed: BlockDocument,
  storedForms: readonly { form: unknown; locked: ReadonlySet<string> }[]
): boolean {
  return storedForms.some(
    ({ form, locked }) =>
      locked.has(change.id) &&
      !layersLockChanges(composed, form).some(held => held.id === change.id)
  );
}

/**
 * Each block a placed component locks that this write changes, moves or
 * removes through its placements, judged on the composition already resolved.
 * Nothing more is composed or read unless the page places such a block, and
 * the stored page is read only once one is found changed.
 */
export async function placedLayersLocks(args: {
  /** The page as written. */
  document: BlockDocument;
  /** Its composition, as the composition check resolved it. */
  composed: BlockDocument;
  reading: {
    library: HeldLibrary;
    read: BoundedReader;
    limits: DocumentLimits;
    work: WorkAllowance;
  };
  stored: () => Promise<{ forms: BlockDocument[]; readable: boolean }>;
}): Promise<PlacedLocksAnswer> {
  const { limits } = args.reading;
  // Gated placements are judged as served once their condition lifts: the
  // page, its baseline and its stored forms all composed with the gates off.
  const ungated = withGatesLifted(args.document, limits);
  const document = ungated ?? args.document;
  const composed =
    ungated === undefined
      ? args.composed
      : (
          await composeWithReads({
            host: ungated,
            library: args.reading.library,
            read: args.reading.read,
            limits,
            work: args.reading.work,
          })
        ).composition.document;
  if (placedLockIds(composed, limits).size === 0) return NONE;
  const asHeld = await composedFormsRead({
    ...args.reading,
    hosts: [placementsAsComponentsHoldThem(document, limits)],
  });
  if (!asHeld.complete) return { kind: "unchecked" };
  const found = layersLockChanges(
    composed,
    placedLocksOnly(asHeld.forms[0], limits)
  );
  if (found.length === 0) return NONE;
  const stored = await args.stored();
  if (!stored.readable) return { kind: "unjudged" };
  // Cut short, a stored form only fails to keep a value: measured strictly.
  const storedComposed = await composedFormsRead({
    ...args.reading,
    hosts: stored.forms.map(form => withGatesLifted(form, limits) ?? form),
  });
  const storedForms = storedComposed.forms.map(form => ({
    form: placedLocksOnly(form, limits),
    locked: placedLockIds(form, limits),
  }));
  return {
    kind: "judged",
    changes: found.filter(change => !keptBy(change, composed, storedForms)),
  };
}
