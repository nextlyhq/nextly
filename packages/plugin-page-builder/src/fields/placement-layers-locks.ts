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
  componentLayersLocks,
  heldBaselines,
  isConditionGated,
  keptForSameComponents,
  placedLockChanges,
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

import { composedFormsRead } from "./lock-baselines";

/** What judging a page's placed locks found. */
export type PlacedLocksAnswer =
  /** Each locked block the write changes, moves or removes; often none. */
  | { readonly kind: "judged"; readonly changes: readonly LayersLockChange[] }
  /** The save's composition allowance ran out before the baseline composed. */
  | { readonly kind: "unchecked" }
  /** The stored page could not be read, so an old value can't be told apart. */
  | { readonly kind: "unjudged" };

const NONE: PlacedLocksAnswer = { kind: "judged", changes: [] };

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

/**
 * The library with every gate lifted in the definitions it holds, or
 * `undefined` when none gates a block: a gated placement inside a definition
 * is left unexpanded by the composition just as one on the page is.
 */
function libraryWithGatesLifted(
  library: HeldLibrary,
  limits: DocumentLimits
): HeldLibrary | undefined {
  let lifted = false;
  const held = new Map<string, unknown>();
  for (const [id, definition] of library.held) {
    const nodes = (definition as { nodes?: unknown } | null)?.nodes;
    const ungated = Array.isArray(nodes)
      ? withGatesLifted(definition as BlockDocument, limits)
      : undefined;
    if (ungated !== undefined) lifted = true;
    held.set(id, ungated ?? definition);
  }
  return lifted ? { held, missing: new Set(library.missing) } : undefined;
}

/** Whether any definition the page reaches locks one of its blocks in Layers. */
function aDefinitionLocks(
  library: HeldLibrary,
  limits: DocumentLimits
): boolean {
  let locks = false;
  for (const definition of library.held.values()) {
    const nodes = (definition as { nodes?: unknown } | null)?.nodes;
    if (!Array.isArray(nodes)) continue;
    walkNodes(
      nodes as BlockNode[],
      node => {
        if ((node as { locked?: unknown }).locked === true) locks = true;
      },
      { maxNodes: limits.maxNodes }
    );
    if (locks) return true;
  }
  return false;
}

/**
 * Each block a placed component locks that this write changes, moves or
 * removes through its placements, judged on the composition already resolved.
 * Nothing more is composed or read unless a definition the page reaches locks
 * a block, and the stored page is read only once one is found changed.
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
  // page, the definitions it reaches, its baseline and its stored forms all
  // composed with the gates off.
  const ungated = withGatesLifted(args.document, limits);
  const library = libraryWithGatesLifted(args.reading.library, limits);
  const reading =
    library === undefined ? args.reading : { ...args.reading, library };
  const document = ungated ?? args.document;
  const composed =
    ungated === undefined && library === undefined
      ? args.composed
      : (await composeWithReads({ host: document, ...reading })).composition
          .document;
  // Asked of the definitions too, not of the composed page alone: a value that
  // hides every block a component locks leaves no lock in the page to find.
  if (
    componentLayersLocks(composed.nodes, limits).size === 0 &&
    !aDefinitionLocks(reading.library, limits)
  ) {
    return NONE;
  }
  const baselines = heldBaselines(document, limits);
  const asHeld = await composedFormsRead({
    ...reading,
    hosts: baselines.map(level => level.document),
  });
  if (!asHeld.complete) return { kind: "unchecked" };
  const held = baselines.map((level, index) => ({
    form: asHeld.forms[index],
    placements: level.placements,
  }));
  if (placedLockChanges(composed, held, [], limits).length === 0) return NONE;
  const stored = await args.stored();
  if (!stored.readable) return { kind: "unjudged" };
  // Cut short, a stored form only fails to keep a value: measured strictly.
  const storedComposed = await composedFormsRead({
    ...reading,
    hosts: stored.forms.map(form =>
      keptForSameComponents(
        document,
        withGatesLifted(form, limits) ?? form,
        limits
      )
    ),
  });
  return {
    kind: "judged",
    changes: placedLockChanges(composed, held, storedComposed.forms, limits),
  };
}
