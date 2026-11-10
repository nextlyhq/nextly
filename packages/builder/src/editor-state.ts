"use client";

/**
 * The editor's document state: what is being edited, what is selected, and how
 * to take an edit back.
 *
 * The op layer already answers "what does this edit do to the document" and
 * hands back an inverse with every application. What was missing is the thing
 * that HOLDS the answer — so every consumer that wanted to edit had to keep its
 * own copy of the document, its own idea of the selection, and its own undo
 * stack. Three of those disagree the moment one of them applies an op the
 * others do not see.
 *
 * So this is deliberately the only place a document changes. A panel, a canvas,
 * a keyboard handler and an agent all reach the same `apply`, and undo works
 * for all of them because it is built from what the op layer actually did
 * rather than from what each caller believed it was doing.
 *
 * **Undo is the op layer's inverse, not a snapshot of the document.** Snapshots
 * are the obvious design and they are wrong here for a reason that shows up
 * late: a document is a tree of unbounded size, so a stack of snapshots grows
 * with page size times history depth, and the copies are of a value that is
 * mostly unchanged between steps. An inverse is one op. It also composes with
 * anything else that produces ops — a collaborative stream, a replayed agent
 * edit — which a snapshot stack does not.
 *
 * @module editor-state
 */

import {
  componentLayersLocks,
  componentUsageIn,
  compositionFaults,
  DEFAULT_LIMITS,
  findNode,
  heldBaselines,
  keptForSameComponents,
  lockRefusal,
  lockRepairRule,
  placedLockChanges,
  placementRefusal,
  placementRepairRule,
  planRepair as planDocumentRepair,
  registryBlockSource,
  registryNestingSource,
  resolveComponentInstances,
  type BlockDocument,
  type CompositionFault,
  type ResolvedComposition,
  type ComponentLookup,
  type DocumentLimits,
  type LocatedPlacementBreak,
  type LockSources,
  type NestingSource,
  type RepairPlan,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";
import { useCallback, useMemo, useRef, useState } from "react";

import { compositionRefusal, type CompositionRefusal } from "./inserter";
import {
  layersLockRefusalFor,
  lockRefusalWording,
  savedLockBrokenBy,
  type LockEditRefusal,
  type LockRefusalFacts,
} from "./lock-refusal";
import { refusalAnnouncement } from "./move-refusal";
import { applyOps, type BuilderOp } from "./op-vocabulary";
import {
  EMPTY_SELECTION,
  applySelection,
  pruneSelection,
  type BlockSelection,
  type SelectionMode,
} from "./selection";

/** How deep the undo history goes before the oldest step is dropped. */
export const MAX_HISTORY = 100;

/**
 * A change made outside the document that the editor's history takes back and
 * puts forward, such as a write to the site's shared styles.
 *
 * Each half resolves whether it took effect. A half that did not (a refused
 * or failed write) leaves the change where it was, so the step is dropped
 * rather than kept as an undo that never clears.
 */
interface HistoryStep {
  /** Takes the change back. */
  readonly undo: () => Promise<boolean>;
  /** Makes the change again. */
  readonly redo: () => Promise<boolean>;
}

/**
 * One entry of the history: a group of the op layer's inverses, or a step
 * recorded from outside the document. Both stacks hold the entry to replay
 * next, so a step on the redo stack is the recorded one with its halves
 * swapped.
 */
type HistoryEntry =
  | { readonly kind: "ops"; readonly ops: readonly BuilderOp[] }
  | {
      readonly kind: "step";
      readonly step: HistoryStep;
      /** The step as recorded, kept as it moves between the stacks. */
      readonly origin: HistoryStep;
    };

/** The step that replays `step` the other way, for the opposite stack. */
function reversed(step: HistoryStep): HistoryStep {
  return { undo: step.redo, redo: step.undo };
}

/** How many entries change the document, which is what a save point counts. */
function documentEntries(stack: readonly HistoryEntry[]): number {
  return stack.filter(entry => entry.kind === "ops").length;
}

export interface EditorState {
  /** The document as it currently stands. */
  document: BlockDocument;
  /** The selected node's id, or null when nothing is selected. */
  selectedId: string | null;
  /**
   * Everything selected, in document order, with the primary named.
   *
   * `selectedId` IS `selection.primary`, derived rather than stored twice: the
   * two disagreeing would put an outline on one block and the inspector on
   * another, and there is no render in which that is what an author meant.
   */
  selection: BlockSelection;
  /** Select a node, or clear the selection with null. */
  select: (id: string | null, mode?: SelectionMode) => void;
  /**
   * Apply an edit. Returns the applied op's outcome, or null when the op was
   * refused — a caller that needs to know whether its edit landed can ask,
   * rather than comparing documents afterwards.
   */
  apply: (op: BuilderOp) => BlockDocument | null;
  /**
   * Apply several ops as ONE action, or nothing at all.
   *
   * For an edit whose subject is a multi-block selection. Atomic — a group that
   * failed halfway would leave a document the author never asked for — and it
   * costs exactly one undo, because "delete these six" is one thing an author
   * did and six presses to take it back would read as the history being wrong.
   *
   * Returns the new document, or `null` when any op was refused and nothing was
   * committed.
   */
  applyAll: (ops: readonly BuilderOp[]) => BlockDocument | null;
  /**
   * The lock break `ops` would add, asked BEFORE they are applied, or
   * undefined when they keep every lock. Nothing is applied.
   *
   * The question `apply` asks, with the same baseline, so a surface that
   * refuses an action ahead of time (a drop indicator, the inserter, a
   * keyboard move, a toolbar action) can never disagree with the apply that
   * would follow.
   */
  lockRefusalFor: (ops: readonly BuilderOp[]) => LockRefusalFacts | undefined;
  /**
   * The repair of everything the document holds that the engine's repair
   * rules put right (its lock breaks, then its placement breaks), planned by
   * the engine's one repair planner against the baseline `apply` judges by.
   * Nothing is applied: a surface shows the plan's steps and, once the
   * author confirms, applies it as one edit. No steps when there is nothing
   * to repair.
   */
  planRepair: () => RepairPlan;
  /**
   * The document as it stands with every component placement composed in,
   * through the composition the edits themselves are judged on (each document
   * composed once); `undefined` where no component library is known. What a
   * surface reads to show the locks a placement's content sits under inside
   * its component, which the page alone does not hold.
   */
  composed: () => BlockDocument | undefined;
  /**
   * The block definitions lock questions are judged by: the host's own
   * `locks.definitions`, or the live registry. A surface showing what a lock
   * holds reads these, so it holds what `apply` refuses.
   */
  lockDefinitions: SlotDefaultSource;
  /**
   * Take back the newest step, and answer whether it took effect: at once for
   * a document edit, and as a promise for a recorded step, once its own undo
   * has answered. So a surface says "Undone" only for a change that was undone.
   */
  undo: () => boolean | Promise<boolean>;
  /** Repeat the newest undone step, answering as `undo` does. */
  redo: () => boolean | Promise<boolean>;
  /**
   * Record a change made outside the document as one step of this history,
   * when the author makes it, so it takes its place in order among the page's
   * edits even while it is still being stored. It ends the redo branch, as an
   * edit does. Answers a function that withdraws the step, for a change that
   * did not take effect after all.
   * @experimental
   */
  recordStep: (step: HistoryStep) => () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * The caps every edit is judged under: the host's, or the engine's defaults
   * when the host named none.
   *
   * Exposed so a surface that asks the resolver whether a placement fits
   * BEFORE applying it asks under the same caps the apply will enforce. Two
   * readings of the site's caps — one here, one handed to the surface — agree
   * until the day one of them is pointed at a different config; the surface
   * reading this one cannot disagree with the apply that follows.
   */
  limits: DocumentLimits;
  /**
   * The document's position in its history: the document edits on the undo
   * stack, plus those that fell off its old end. A recorded step is not one:
   * it is stored where it was made, so it is no unsaved work here. The same as
   * the number on the stack until the history passes its bound.
   *
   * Exported because "did anything change" is not answerable from the document
   * alone: an edit and its undo leave a document equal to the original but not
   * identical to it, so a host comparing references sees a change and a host
   * comparing values misses a real one. A depth is the honest signal, and a
   * test can read it — which a boolean derived inside a component cannot.
   */
  undoDepth: number;
  /**
   * The collection lists the canvas draws in their empty state rather than
   * their entries, by id: what "Canvas shows: When empty" chose, so an author
   * can design what visitors see when nothing matches. Editor state only,
   * never stored, and not a step of the history.
   * @experimental
   */
  listsShowingEmpty?: ReadonlySet<string>;
  /** Draw one list's empty state on the canvas, or its entries again. */
  showListEmpty?: (id: string, empty: boolean) => void;
  /**
   * The list whose sort the author last asked to fix, from its canvas note's
   * "Choose a field", with a count that grows on each ask, so the inspector
   * takes the author to the list's first sort row once per press. Editor
   * state only, never stored.
   * @experimental
   */
  sortFieldAsked?: { readonly id: string; readonly seq: number };
  /** Select a list and take the author to its first sort row. */
  askSortField?: (id: string) => void;
}

export interface UseEditorStateArgs {
  /** The document to start from. */
  initialDocument: BlockDocument;
  /** The caps this site holds its documents to. */
  limits?: DocumentLimits;
  /**
   * The definitions the canvas draws component instances from, so an edit is
   * refused when the page would no longer compose with it in.
   *
   * The op layer counts a stored instance as ONE node and cannot see that the
   * resolver spends a budget across every instance it inlines, in document
   * order, and nests to a depth counted from the page root. Handed the
   * definitions, the apply asks the resolver about every accepted group —
   * an insert, a move that carries an instance ahead of another, a duplicated
   * or pasted copy, a pattern bringing instances of its own — and refuses the
   * edit that would leave a placeholder where a component stood. Absent, a
   * host that resolves nothing keeps the apply it had.
   */
  definitions?: ComponentLookup;
  /**
   * Told why an edit was refused for room, with the sentence the author
   * should read. Surfaces already treat a `null` apply as "nothing happened";
   * this is the one place the reason is still known.
   */
  onRefused?: (refusal: CompositionRefusal) => void;
  /**
   * Told why an edit was refused for a lock, with the sentence the author
   * should read. Separate from `onRefused`, whose refusals are about room and
   * keep the shape its callers were written against.
   */
  onLockRefused?: (refusal: LockEditRefusal) => void;
  /**
   * A component's name by its id, for the refusal of an edit to a block the
   * component locks: the page cannot unlock it, so the author is told whose
   * it is. Absent, the refusal names no component.
   */
  componentName?: (componentId: string) => string | undefined;
  /**
   * Where the locks an edit is held to are read: the block definitions and
   * nesting rules. Defaults to the live registry, so every host's editor holds
   * the locks its saves enforce.
   */
  locks?: Pick<LockSources, "definitions" | "nesting">;
  /**
   * The document as last saved: the stored form a save keeps `contentOnly`
   * values against, so the editor keeps exactly what the save would. A host
   * passes the saved value again after every save; absent, the document as
   * opened stands for it.
   */
  stored?: BlockDocument;
  /**
   * Told when an edit was refused because it would put a block where the
   * placement rule forbids, with the block and the reason. Every editor path
   * (insert, drag, keyboard, toolbar, paste) ends in an op group here, so this
   * is the one check none of them can miss, whatever a surface asked first.
   */
  onPlacementRefused?: (refusal: LocatedPlacementBreak) => void;
}

/**
 * Whether an edit that turned `before` into `after` puts a block where the
 * placement rule forbids — telling the host which, when it does. A break the
 * page already held is not the edit's, so it is not refused here.
 *
 * Judged on the page itself, without composing its component placements: an
 * edit composes the page once, for room and locks, and composing each
 * placement again here would double that on every keystroke. What a placement
 * draws is judged by the surfaces before they act and by the save.
 */
function refusedForPlacement(
  before: BlockDocument,
  after: BlockDocument,
  { onPlacementRefused }: Pick<UseEditorStateArgs, "onPlacementRefused">,
  limits: DocumentLimits
): boolean {
  const refusal = placementRefusal(
    before,
    after,
    { nesting: registryNestingSource(), definitions: registryBlockSource() },
    limits
  );
  if (refusal === undefined) return false;
  onPlacementRefused?.(refusal);
  return true;
}

/**
 * Whether an edit that turned `before` into `after` leaves the page without
 * room for a component it holds — telling the host why, when it does.
 *
 * Nothing to ask without definitions: a host that resolves nothing has no
 * composition to judge, and keeps the apply it had.
 */
function refusedForRoom(
  before: BlockDocument,
  after: BlockDocument,
  {
    definitions,
    onRefused,
  }: Pick<UseEditorStateArgs, "definitions" | "onRefused">,
  limits: DocumentLimits,
  compose: Composer
): boolean {
  if (definitions === undefined) return false;
  const refusal = compositionRefusal(
    before,
    after,
    definitions,
    limits,
    compose
  );
  if (refusal === undefined) return false;
  onRefused?.(refusal);
  return true;
}

/** A document as composed, under the store's components and limits. */
type Composer = (document: BlockDocument) => ResolvedComposition;

/** Compositions already made, by document, and what they were made under. */
interface CompositionCache {
  readonly components: ComponentLookup | undefined;
  readonly limits: DocumentLimits;
  readonly byDocument: WeakMap<BlockDocument, ResolvedComposition>;
}

/**
 * Compose through the cache, so each document is composed once.
 *
 * Every edit asks of three documents: the one before it, the one it makes and
 * the one last saved. The one before is the last edit's result, and the saved
 * one changes only with a save, so both are already composed; an edit
 * composes only the document it makes. Keyed by the document OBJECT, which the
 * store never changes in place, and dropped whole when the components or the
 * limits change, since a composition is made under both.
 */
function composerFrom(
  cache: { current: CompositionCache },
  components: ComponentLookup,
  limits: DocumentLimits
): Composer {
  if (
    cache.current.components !== components ||
    cache.current.limits !== limits
  ) {
    cache.current = { components, limits, byDocument: new WeakMap() };
  }
  const { byDocument } = cache.current;
  return document => {
    let composed = byDocument.get(document);
    if (composed === undefined) {
      // With the exposure map: the editor's composition is never rendered or
      // saved, and the canvas reaches a value inside a component through it.
      composed = resolveComponentInstances(document, components, {
        limits,
        exposures: true,
      });
      byDocument.set(document, composed);
    }
    return composed;
  };
}

/** What a lock question reads besides the documents. */
interface LockJudgement {
  readonly locks: UseEditorStateArgs["locks"];
  readonly limits: DocumentLimits;
  /** The composed page, for the locks a placement reaches inside a component. */
  readonly compose: Composer | undefined;
  /** A component's name, for a refusal of a block it locks. */
  readonly componentName: UseEditorStateArgs["componentName"];
}

/**
 * Whether an edit that turned `before` into `after` adds a lock break,
 * telling the host why, when it does.
 *
 * Judged as a save judges it, by the engine's `lockRefusal`, with the document
 * as last saved as the stored form, so a value the stored page holds stays
 * allowed after edits in between, and one a saved repair removed does not.
 */
function refusedForLock(
  before: BlockDocument,
  after: BlockDocument,
  stored: BlockDocument,
  judgement: LockJudgement,
  onLockRefused: UseEditorStateArgs["onLockRefused"]
): boolean {
  const found = lockBreakAdded(before, after, stored, judgement);
  if (found === undefined) return false;
  onLockRefused?.({
    reason: "locked",
    sentence: refusalAnnouncement(lockRefusalWording(found)),
    lock: found,
  });
  return true;
}

/**
 * The lock break an edit adds, judged against the last-saved document: on the
 * page itself, then on the composed page, where a placement's values and slot
 * content land inside its component's own locked slots.
 */
function lockBreakAdded(
  before: BlockDocument,
  after: BlockDocument,
  stored: BlockDocument,
  judgement: LockJudgement
): LockRefusalFacts | undefined {
  const sources = lockSourcesOf(judgement.locks, stored, judgement.limits);
  return (
    lockRefusal(before, after, sources) ??
    composedLockAdded(before, after, stored, sources, judgement)
  );
}

/**
 * A block a placed component locks in Layers that the edit changes through a
 * placement, judged as a save judges it (`placedLockChanges`): the composed
 * page against the same page with every placement as its component holds it,
 * keeping a value the page already gave the block, before this edit or as
 * last saved. Named by the component, since the page cannot unlock it.
 */
function componentLockAdded(
  after: BlockDocument,
  composedAfter: BlockDocument,
  kept: readonly BlockDocument[],
  {
    compose,
    limits,
    componentName,
  }: Pick<LockJudgement, "limits" | "componentName"> & { compose: Composer }
): LockRefusalFacts | undefined {
  // Asked of the as-held baseline, not of the page after the edit: an edit
  // that hides or removes the locked block leaves no lock after it to find,
  // but the page before it, or as saved, still draws one. A page none of
  // whose forms draws a component lock composes nothing more.
  const drawsLock = [composedAfter, ...kept].some(
    form => componentLayersLocks(form.nodes, limits).size > 0
  );
  if (!drawsLock) return undefined;
  const held = heldBaselines(after, limits).map(level => ({
    form: compose(level.document).document,
    placements: level.placements,
  }));
  const [change] = placedLockChanges(composedAfter, held, kept, limits);
  if (change === undefined) return undefined;
  return componentLockFacts(
    componentNameOf(after, change.placementId, componentName)
  );
}

/** The name of the component a page's placement draws, or "" when none is known. */
function componentNameOf(
  page: BlockDocument,
  placementId: string | undefined,
  componentName: LockJudgement["componentName"]
): string {
  const placement =
    placementId === undefined ? undefined : findNode(page.nodes, placementId);
  const componentId = (
    placement?.props as { componentId?: unknown } | undefined
  )?.componentId;
  return typeof componentId === "string"
    ? (componentName?.(componentId) ?? "")
    : "";
}

/** A refusal for a block a component locks, named by the component. */
function componentLockFacts(name: string): LockRefusalFacts {
  return {
    code: "layers-locked",
    label: name,
    relation: "component",
    verb: "change",
  };
}

/**
 * The lock break an edit adds to the composed page, judged by the engine's
 * `compositionFaults`, the check a save runs over the same composition.
 *
 * "Adds" as on the page itself: a break the composed page already had before
 * the edit is left to the repair, and the document before the edit and as last
 * saved, both composed, are the baselines a `"contentOnly"` value may keep.
 */
function composedLockAdded(
  before: BlockDocument,
  after: BlockDocument,
  stored: BlockDocument,
  sources: LockSources,
  { compose, limits, componentName }: LockJudgement
): LockRefusalFacts | undefined {
  if (compose === undefined) return undefined;
  // A page placing no component has no composed break to add.
  const placed = componentUsageIn(after.nodes, limits.maxNodes);
  if (placed.complete && placed.ids.length === 0) return undefined;
  const composedBefore = compose(before);
  const baselines = [composedBefore.document, compose(stored).document];
  const composedAfter = compose(after);
  // A value is kept only under the component that gave it: a placement this
  // edit switches to another component is left out of the forms it keeps.
  const kept = [before, stored].map((form, index) => {
    const same = keptForSameComponents(after, form, limits);
    return same === form ? baselines[index] : compose(same).document;
  });
  const held = componentLockAdded(after, composedAfter.document, kept, {
    compose,
    limits,
    componentName,
  });
  if (held !== undefined) return held;
  const lockFaults = (host: BlockDocument, composition: ResolvedComposition) =>
    compositionFaults(host, composition, {
      definitions: sources.definitions,
      nesting: sources.nesting,
      limits,
      baselines,
    }).filter(fault => fault.lock !== undefined);
  const had = new Set(lockFaults(before, composedBefore).map(composedBreakKey));
  const added = lockFaults(after, composedAfter).find(
    fault => !had.has(composedBreakKey(fault))
  );
  if (added?.lock === undefined) return undefined;
  return {
    code:
      added.code === "locked-slot-content-only"
        ? "locked-slot-content-only"
        : "locked-slot-altered",
    holderType: added.lock.holderType,
    lock: added.lock.lock,
    childType: added.lock.childType,
    instanceId: added.instanceId,
  };
}

/** What the store reads at apply time: the host's sources and its saved copy. */
interface AtApply
  extends Pick<
    UseEditorStateArgs,
    | "definitions"
    | "onRefused"
    | "onLockRefused"
    | "locks"
    | "onPlacementRefused"
    | "componentName"
  > {
  /** The document as last saved; the document as opened when none is given. */
  readonly stored: BlockDocument;
}

function atApply(
  host: Pick<
    UseEditorStateArgs,
    | "definitions"
    | "onRefused"
    | "onLockRefused"
    | "locks"
    | "stored"
    | "onPlacementRefused"
    | "componentName"
  >,
  opened: BlockDocument
): AtApply {
  return {
    componentName: host.componentName,
    definitions: host.definitions,
    onRefused: host.onRefused,
    onLockRefused: host.onLockRefused,
    locks: host.locks,
    stored: host.stored ?? opened,
    onPlacementRefused: host.onPlacementRefused,
  };
}

/**
 * The definitions lock questions are judged by: the host's own, or the live
 * registry. Held per source, so the store keeps its identity across renders.
 */
function useLockDefinitions(
  locks: UseEditorStateArgs["locks"]
): SlotDefaultSource {
  const host = locks?.definitions;
  return useMemo(() => host ?? registryBlockSource(), [host]);
}

/** The rules a repair runs, in order. */
const REPAIR_RULES = [lockRepairRule, placementRepairRule] as const;

/**
 * The store's lock questions, asked of the document as it stands and the
 * baseline as last saved, with the composer the room check shares.
 */
function useLockQuestions(
  latestDocument: { current: BlockDocument },
  composition: { current: AtApply },
  limits: DocumentLimits,
  /** The document as last saved, as this render holds it. */
  baseline: BlockDocument,
  locks: UseEditorStateArgs["locks"]
): {
  composerNow: () => Composer | undefined;
  lockRefusalFor: EditorState["lockRefusalFor"];
  planRepair: EditorState["planRepair"];
  composed: EditorState["composed"];
  lockDefinitions: SlotDefaultSource;
} {
  const composerNow = useComposer(composition, limits);
  // The sources and the baseline as values, not through the ref: a host that
  // swaps either, or a save that changes the baseline without changing the
  // document, gives these callbacks, and so the store, a new identity, and a
  // surface asking once per store asks again.
  const definitions = locks?.definitions;
  const nesting = locks?.nesting;
  const lockRefusalFor = useCallback(
    (ops: readonly BuilderOp[]): LockRefusalFacts | undefined => {
      // Read at the question, as the apply reads it.
      const componentName = composition.current.componentName;
      return lockAnswerFor(latestDocument.current, ops, baseline, {
        locks: hostLocksOf(definitions, nesting),
        limits,
        compose: composerNow(),
        componentName,
      });
    },
    [
      latestDocument,
      composition,
      limits,
      composerNow,
      baseline,
      definitions,
      nesting,
    ]
  );

  const planRepair = useCallback(
    (): RepairPlan =>
      // The lock rule first and the placement rule after it, so a block a
      // lock repair moves is judged where the lock rule put it.
      planDocumentRepair(
        latestDocument.current,
        lockSourcesOf(hostLocksOf(definitions, nesting), baseline, limits),
        REPAIR_RULES
      ),
    [latestDocument, limits, baseline, definitions, nesting]
  );
  const composed = useCallback(
    (): BlockDocument | undefined =>
      composerNow()?.(latestDocument.current).document,
    [composerNow, latestDocument]
  );
  const lockDefinitions = useLockDefinitions(locks);
  return { composerNow, lockRefusalFor, planRepair, composed, lockDefinitions };
}

/**
 * The host's lock sources as `UseEditorStateArgs` spells them: none without
 * definitions of its own, which then come from the live registry.
 */
function hostLocksOf(
  definitions: SlotDefaultSource | undefined,
  nesting: NestingSource | undefined
): UseEditorStateArgs["locks"] {
  return definitions === undefined ? undefined : { definitions, nesting };
}

/**
 * The composer for the components the store holds at the moment it is asked,
 * or none without them; the compositions the room and lock checks share. See
 * `composerFrom`.
 */
function useComposer(
  composition: { current: Pick<UseEditorStateArgs, "definitions"> },
  limits: DocumentLimits
): () => Composer | undefined {
  const compositions = useRef<CompositionCache>({
    components: undefined,
    limits,
    byDocument: new WeakMap(),
  });
  return useCallback((): Composer | undefined => {
    const components = composition.current.definitions;
    return components === undefined
      ? undefined
      : composerFrom(compositions, components, limits);
  }, [composition, limits]);
}

/**
 * Whether a fresh edit is refused: it deletes a block the saved page still
 * holds locked, the page no longer composes, or the edit adds a lock break.
 * The host is told why, in that order.
 */
function refusedAsFresh(
  before: BlockDocument,
  after: BlockDocument,
  {
    stored,
    current,
    limits,
    compose,
    ops,
  }: {
    stored: BlockDocument;
    current: Pick<
      UseEditorStateArgs,
      "definitions" | "onRefused" | "onLockRefused" | "locks" | "componentName"
    >;
    limits: DocumentLimits;
    compose: Composer | undefined;
    /** The edit's ops, for the saved page's Layers lock on what it deletes. */
    ops: readonly BuilderOp[];
  }
): boolean {
  // A delete of a block the SAVED page still holds locked, though the author
  // has unlocked it since: a save would refuse it, so the edit is refused now,
  // with the way forward.
  if (reportLayersLock(before, ops, current.onLockRefused, after, stored)) {
    return true;
  }
  if (
    compose !== undefined &&
    refusedForRoom(before, after, current, limits, compose)
  ) {
    return true;
  }
  return refusedForLock(
    before,
    after,
    stored,
    judgementOf(current, limits, compose),
    current.onLockRefused
  );
}

/**
 * The lock `ops` would break in `document`, applied only to ask: a block
 * locked in Layers first, now or on the saved page for a delete, then the
 * slot locks a block declares. Ops the document cannot take for another
 * reason are the apply's to refuse; they add no lock break, because they add
 * nothing.
 */
function lockAnswerFor(
  document: BlockDocument,
  ops: readonly BuilderOp[],
  stored: BlockDocument,
  judgement: LockJudgement
): LockRefusalFacts | undefined {
  const layers = layersLockRefusalFor(document, ops, stored);
  if (layers !== undefined) return layers;
  let group;
  try {
    group = applyOps(document, ops, judgement.limits);
  } catch {
    return undefined;
  }
  if (group.inverses.length === 0) return undefined;
  return lockBreakAdded(document, group.document, stored, judgement);
}

/**
 * Tell the host which Layers lock refused an edit, and answer whether one did.
 *
 * With `after` and `stored`, the edit applied and only the saved page's lock
 * on a block it deletes is asked (`savedLockBrokenBy`); without them, the
 * edit was refused by the op layer and the lock it broke is found again.
 */
function reportLayersLock(
  before: BlockDocument,
  ops: readonly BuilderOp[],
  onLockRefused: UseEditorStateArgs["onLockRefused"],
  after?: BlockDocument,
  stored?: BlockDocument
): boolean {
  const found =
    after === undefined || stored === undefined
      ? layersLockRefusalFor(before, ops)
      : savedLockBrokenBy(before, after, stored, ops);
  if (found === undefined) return false;
  onLockRefused?.({
    reason: "locked",
    sentence: refusalAnnouncement(lockRefusalWording(found)),
    lock: found,
  });
  return true;
}

/** The lock judgement from what the store reads at apply time. */
function judgementOf(
  current: Pick<UseEditorStateArgs, "locks" | "componentName">,
  limits: DocumentLimits,
  compose: Composer | undefined
): LockJudgement {
  return {
    locks: current.locks,
    limits,
    compose,
    componentName: current.componentName,
  };
}

/**
 * A composed break by its rule, its placement, its locked slot and, for the
 * blocks a slot holds, which blocks those are: so a slot already broken may
 * keep its blocks, as on the page itself, but not change them further.
 */
function composedBreakKey(fault: CompositionFault): string {
  const { lock } = fault;
  if (lock === undefined) return `${fault.code}\u0000${fault.instanceId}`;
  return [
    fault.code,
    fault.instanceId,
    lock.holderId,
    lock.slot,
    lock.heldCount,
    heldKey(lock),
  ].join("\u0000");
}

/**
 * The blocks a locked slot holds, as a key: in order where the lock fixes the
 * order, and as a set of types where it only fixes membership (`"insert"`).
 */
function heldKey(lock: NonNullable<CompositionFault["lock"]>): string {
  const held = lock.held.map(type => type ?? "\u0001");
  if (lock.lock === "insert") held.sort();
  return held.join("\u0002");
}

/**
 * What every lock question here is judged by: the host's definitions and
 * nesting rules, or the live registry's, the document as last saved, and the
 * caps every edit is applied under, so a lock walk and a repair plan are
 * bounded as the apply they stand for is.
 */
function lockSourcesOf(
  locks: UseEditorStateArgs["locks"],
  stored: BlockDocument,
  limits: DocumentLimits
): LockSources {
  return {
    definitions: locks?.definitions ?? registryBlockSource(),
    nesting: locks?.nesting ?? registryNestingSource(),
    stored: [stored],
    limits,
  };
}

/**
 * The undo and redo stacks, and the depths a render reads from them.
 *
 * READONLY groups. A recorded inverse describes the document as it stood when
 * its op ran, so nothing may append to or reorder one after the fact — the
 * history would then describe an edit that never happened. `applyOps` returns
 * them already in undo order and already frozen to the type.
 */
function useHistoryStacks(): {
  depths: { undo: number; redo: number; document: number };
  push: (
    entry: HistoryEntry,
    into: "undo" | "redo" | "new"
  ) => HistoryEntry | undefined;
  pop: (from: "undo" | "redo") => HistoryEntry | undefined;
  remove: (entry: HistoryEntry) => void;
  withdraw: (origin: HistoryStep, dropped: HistoryEntry | undefined) => void;
  /** A replay of the step took effect; the branch it ended is gone. */
  settle: (origin: HistoryStep) => void;
} {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  // Mirrors the stack lengths so the flags below are STATE and re-render when
  // they change. Reading `undoStack.current.length` directly would leave an
  // undo button disabled after the first edit, because a ref mutation does not
  // schedule a render.
  const [depths, setDepths] = useState({ undo: 0, redo: 0, document: 0 });
  /*
   * Document edits dropped off the old end. The save point measures the
   * document's position in its history, and that position does not move
   * because the history forgets how it got there: counted in, a page saved
   * before a run of style changes stays saved once its edit falls off.
   */
  const forgotten = useRef(0);
  const sync = useCallback(() => {
    setDepths({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
      document: documentEntries(undoStack.current) + forgotten.current,
    });
  }, []);
  /*
   * The redo branch a run of recorded steps ended, with those steps and the
   * entry below the first, so that withdrawing every one of them before
   * anything else follows gives the branch back: changes that never took
   * effect must not cost the author their redo either. Kept while the steps
   * are recorded one after another, and while any of them only moves between
   * the stacks unanswered, since each change may still be refused; dropped
   * once a replay of one takes effect or any other entry is pushed.
   */
  const endedBranch = useRef<StepRun | null>(null);
  const push = useCallback(
    (entry: HistoryEntry, into: "undo" | "redo" | "new") => {
      let dropped: HistoryEntry | undefined;
      endedBranch.current = runAfterPush(
        endedBranch.current,
        entry,
        into,
        undoStack.current.at(-1),
        redoStack.current
      );
      if (into === "redo") {
        redoStack.current.push(entry);
      } else {
        undoStack.current.push(entry);
      }
      if (into === "new") {
        // Bounded from the OLD end. Dropping the newest would make the most
        // recent edit unrepeatable, which is the one an author is most likely
        // to want back.
        if (undoStack.current.length > MAX_HISTORY) {
          dropped = undoStack.current.shift();
          if (dropped?.kind === "ops") forgotten.current += 1;
        }
        // A new edit invalidates the redo branch: those inverses were computed
        // against a document that no longer exists, so replaying one would
        // apply an edit derived from a tree that has since changed.
        redoStack.current = [];
      }
      sync();
      return dropped;
    },
    [sync]
  );
  const pop = useCallback(
    (from: "undo" | "redo") => {
      const entry = (from === "undo" ? undoStack : redoStack).current.pop();
      sync();
      return entry;
    },
    [sync]
  );
  const remove = useCallback(
    (entry: HistoryEntry) => {
      undoStack.current = undoStack.current.filter(held => held !== entry);
      redoStack.current = redoStack.current.filter(held => held !== entry);
      sync();
    },
    [sync]
  );
  /*
   * Take a recorded step back out, wherever it sits: undone, it is on the
   * redo stack under another entry. The entry its recording pushed off a full
   * history comes back to the old end, since a change that never took effect
   * must not cost the oldest edit.
   */
  const withdraw = useCallback(
    (origin: HistoryStep, dropped: HistoryEntry | undefined) => {
      const kept = (held: HistoryEntry) =>
        held.kind !== "step" || held.origin !== origin;
      // With the last step of the run gone, the history as it was before it
      // began (nothing made since, and nothing else undone): the redo branch
      // the run ended comes back with that withdrawal. While others of the
      // run remain, one of them may yet take effect, so the branch waits.
      const ended = endedBranch.current;
      ended?.steps.delete(origin);
      const last = ended !== null && ended.steps.size === 0;
      if (last) endedBranch.current = null;
      undoStack.current = undoStack.current.filter(kept);
      const redo = redoStack.current.filter(kept);
      const restore =
        last && undoStack.current.at(-1) === ended.below && redo.length === 0
          ? ended.branch
          : [];
      redoStack.current = [...redo, ...restore];
      if (dropped !== undefined && undoStack.current.length < MAX_HISTORY) {
        undoStack.current.unshift(dropped);
        if (dropped.kind === "ops") forgotten.current -= 1;
      }
      sync();
    },
    [sync]
  );
  /*
   * A replay of a step of the run took effect: its change and its undo are
   * both real, so the branch the run ended is gone for good.
   */
  const settle = useCallback((origin: HistoryStep) => {
    if (endedBranch.current?.steps.has(origin) === true) {
      endedBranch.current = null;
    }
  }, []);
  return { depths, push, pop, remove, withdraw, settle };
}

/** A run of recorded steps, the redo branch it ended, and what lay below it. */
interface StepRun {
  steps: Set<HistoryStep>;
  below: HistoryEntry | undefined;
  branch: HistoryEntry[];
}

/**
 * The run of recorded steps once `entry` is pushed: a new step joins the run
 * or starts one (keeping the branch it ends and what lay below), a step of
 * the run moving between the stacks keeps it, and anything else ends it.
 */
function runAfterPush(
  run: StepRun | null,
  entry: HistoryEntry,
  into: "undo" | "redo" | "new",
  below: HistoryEntry | undefined,
  branch: HistoryEntry[]
): StepRun | null {
  if (entry.kind !== "step") return null;
  if (into !== "new") return run?.steps.has(entry.origin) === true ? run : null;
  if (run === null) return { steps: new Set([entry.origin]), below, branch };
  run.steps.add(entry.origin);
  return run;
}

/**
 * Replay a recorded step and move it to the other stack at once, so a second
 * press reaches the entry before it rather than waiting on a write. Dropped
 * again if the replay did not take effect, for the reason a refused inverse is
 * not pushed back.
 */
function replayStep(
  { step, origin }: { step: HistoryStep; origin: HistoryStep },
  into: "undo" | "redo",
  push: (entry: HistoryEntry, into: "undo" | "redo") => void,
  remove: (entry: HistoryEntry) => void,
  settle: (origin: HistoryStep) => void
): Promise<boolean> {
  const moved: HistoryEntry = { kind: "step", step: reversed(step), origin };
  push(moved, into);
  return step.undo().then(
    took => {
      if (took) settle(origin);
      else remove(moved);
      return took;
    },
    () => {
      remove(moved);
      return false;
    }
  );
}

/**
 * Hold a document and the edits made to it.
 *
 * The document is state and the history is a ref: history changes on every edit
 * but nothing RENDERS from the stacks themselves, only from whether they are
 * empty, so keeping them in state would re-render every consumer on each edit
 * to deliver a value none of them read.
 */
/**
 * Which lists the canvas shows empty, and the way to change it: a new set
 * only when one changes, so the canvas, which draws per set, draws again only
 * then.
 */
function useListsShowingEmpty(): {
  listsShowingEmpty: ReadonlySet<string>;
  showListEmpty: (id: string, empty: boolean) => void;
} {
  const [listsShowingEmpty, setListsShowingEmpty] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const showListEmpty = useCallback((id: string, empty: boolean) => {
    setListsShowingEmpty(current => toggled(current, id, empty));
  }, []);
  return { listsShowingEmpty, showListEmpty };
}

/** `current` with `id` in it or not, the same set when nothing changes. */
function toggled(
  current: ReadonlySet<string>,
  id: string,
  present: boolean
): ReadonlySet<string> {
  if (current.has(id) === present) return current;
  const next = new Set(current);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * The editor's state: the document and its history, with which lists the
 * canvas shows empty and which list's sort the author asked to fix beside
 * them, which are editor state and no step of the history.
 */
export function useEditorState(args: UseEditorStateArgs): EditorState {
  const state = useDocumentState(args);
  const { listsShowingEmpty, showListEmpty } = useListsShowingEmpty();
  const [sortFieldAsked, setSortFieldAsked] =
    useState<EditorState["sortFieldAsked"]>(undefined);
  const { select } = state;
  // Selecting first, so the inspector the author is taken to is the list's.
  const askSortField = useCallback(
    (id: string) => {
      select(id);
      setSortFieldAsked(current => ({ id, seq: (current?.seq ?? 0) + 1 }));
    },
    [select]
  );
  return useMemo(
    () => ({
      ...state,
      listsShowingEmpty,
      showListEmpty,
      ...(sortFieldAsked === undefined ? {} : { sortFieldAsked }),
      askSortField,
    }),
    [state, listsShowingEmpty, showListEmpty, sortFieldAsked, askSortField]
  );
}

/** The document, its selection and its history: see {@link useEditorState}. */
function useDocumentState({
  initialDocument,
  limits = DEFAULT_LIMITS,
  definitions,
  onRefused,
  onLockRefused,
  locks,
  stored,
  onPlacementRefused,
  componentName,
}: UseEditorStateArgs): EditorState {
  // Read at apply time rather than closed over, so a library that reloads or
  // a host that swaps its callback does not rebuild `apply` and everything
  // keyed on it.
  // The document as last saved is read the same way, so a save the host
  // reports takes effect on the very next edit.
  const host = {
    definitions,
    onRefused,
    onLockRefused,
    locks,
    stored,
    onPlacementRefused,
    componentName,
  };
  const composition = useRef(atApply(host, initialDocument));
  composition.current = atApply(host, initialDocument);
  const [document, setDocument] = useState<BlockDocument>(initialDocument);
  const [selection, setSelection] = useState<BlockSelection>(EMPTY_SELECTION);

  /**
   * The document as it stands NOW, for everything a LATER event reaches.
   *
   * Every callback below closes over the render it was made in. Most callers
   * take theirs from the current render and the distinction never shows, but
   * two paths do not, and both read this ref rather than the state.
   *
   * `select`, because a gesture is handled by whatever handler the last render
   * bound and the selection rules need the document that is current when the
   * click lands. Closing over it resolves a range against a stale tree, which
   * is a wrong selection rather than a missing one.
   *
   * `run`, because a panel that commits from an unmount cleanup necessarily
   * holds an older callback: the component going away does not render again, so
   * its closure predates the very edit that removed it. Folding onto that older
   * document did not merely apply a stale edit — it SUCCEEDED where it should
   * have been refused, the node still being present in that copy, and then
   * wrote the whole document back. Deleting a block with an unsaved panel open
   * restored the block and discarded everything since. Read through the ref the
   * same call is refused, which is what callers are already written to handle.
   *
   * The hazard was named here for `select` alone and left on the op path, which
   * is the more expensive of the two.
   */
  const latestDocument = useRef(document);
  const { composerNow, lockRefusalFor, planRepair, composed, lockDefinitions } =
    useLockQuestions(
      latestDocument,
      composition,
      limits,
      composition.current.stored,
      locks
    );
  latestDocument.current = document;

  const { depths, push, pop, remove, withdraw, settle } = useHistoryStacks();

  /**
   * Run an op and record its inverse on the given stack.
   *
   * Shared by `apply`, `undo` and `redo` because all three are the same
   * operation with a different destination for the inverse — undo pushes onto
   * redo and vice versa. Written once so the three cannot disagree about what
   * a refused op does, which is nothing at all: no state change, no history
   * entry, and the caller told.
   */
  /**
   * Apply a GROUP of ops as one action.
   *
   * ## Atomic, and that is the point
   *
   * Every op is folded onto a WORKING document and nothing is committed until
   * all of them have succeeded. A group that failed halfway would leave the
   * document in a state the author never asked for and no single undo could
   * leave — deleting four of six blocks because the fifth was locked is worse
   * than deleting none.
   *
   * ## One group, one undo
   *
   * The inverses are collected in REVERSE order and pushed as a single stack
   * entry. Undo granularity belongs to the history rather than to the document
   * format: the op vocabulary stays four flat kinds, which matters because ops
   * are persisted in a `json()` column and a nested "batch" op would make every
   * reader of that column understand recursion.
   *
   * A single op is a group of one, so there is one code path rather than a fast
   * path and a batch path that can drift.
   */
  const run = useCallback(
    (
      ops: readonly BuilderOp[],
      into: "undo" | "redo" | "new"
    ): BlockDocument | null => {
      let group;
      try {
        // ONE call rather than a fold here, so the group's atomicity and its
        // inverse ordering live in one place: `applyOps` returns the inverses
        // in undo order and answers with none at all when the group left the
        // document as it found it.
        //
        // It does NOT make the caps a group-level decision. Every op is still
        // judged against the document as it stands when that op runs, which is
        // what keeps an accepted edit undoable — a group allowed to exceed the
        // cap in passing can hand back an inverse the cap then refuses, and
        // `undo` pops its entry before replaying it.
        //
        // So a group's outcome can depend on the order its ops arrive in, and
        // nothing below this line changes that. A caller whose ops are known to
        // be independent could order them; none does today.
        group = applyOps(latestDocument.current, ops, limits);
      } catch {
        // A refused group is an ordinary outcome, not a crash: an insert past a
        // cap, a move onto a node that no longer exists, an update to a node
        // a concurrent edit removed. The caller decides what to say about it.
        // Nothing is committed — see the atomicity note above.
        //
        // A block locked in Layers is the one refusal the host is told the
        // reason for here, in the lock's own words, whichever surface sent the
        // edit: nothing on the canvas explains it otherwise.
        if (into === "new") {
          reportLayersLock(
            latestDocument.current,
            ops,
            composition.current.onLockRefused
          );
        }
        return null;
      }

      // NO inverses is the ONE answer to "is there anything to record", and it
      // covers both ways of arriving at nothing: a group with no ops, and a
      // group whose ops left the document as they found it. Either would be a
      // history entry whose undo has no visible effect, which reads as the
      // history being broken.
      //
      // Asked of `applyOps` rather than answered here from `ops.length`, so
      // one place decides what an empty group means. Answering here would
      // answer before the op layer has seen the group at all, while a direct
      // `applyOps` caller would still get the op layer's answer — one group
      // with two verdicts.
      if (group.inverses.length === 0) return latestDocument.current;

      // Whether the page still composes and keeps its locks, asked of a
      // fresh edit only. An undo or a redo returns the page to a state that
      // was accepted when it was made, and a library that grew or a cap that
      // shrank since must not strand the history.
      if (
        into === "new" &&
        refusedAsFresh(latestDocument.current, group.document, {
          stored: composition.current.stored,
          current: composition.current,
          limits,
          compose: composerNow(),
          ops,
        })
      ) {
        return null;
      }
      // A fresh edit only, for the reason room is: an undo or a redo returns
      // the page to a state that was accepted when it was made.
      if (
        into === "new" &&
        refusedForPlacement(
          latestDocument.current,
          group.document,
          composition.current,
          limits
        )
      ) {
        return null;
      }

      const applied = { document: group.document, inverse: group.inverses };
      const entry: HistoryEntry = { kind: "ops", ops: applied.inverse };

      push(entry, into);
      // Ahead of `setDocument`, which does not take effect until the next
      // render: two ops applied in one tick must see each other, or the second
      // is folded onto the document the first already replaced.
      latestDocument.current = applied.document;
      setDocument(applied.document);

      // A selection pointing at a node this edit removed would leave every
      // panel describing something the author cannot see. Cleared by asking the
      // NEW document whether the id is still there, rather than by inspecting
      // the op — an op that removes a container removes its subtree too, and
      // the op names only the container.
      setSelection(current => pruneSelection(applied.document, current));

      return applied.document;
    },
    // NOT `document`: it is read through the ref above, so depending on it here
    // would rebuild these callbacks every edit for a value none of them close
    // over. Stable identity is also the point — a stale `run` is now the same
    // `run`, folding onto the tree as it stands.
    [limits, composerNow, push]
  );

  const apply = useCallback((op: BuilderOp) => run([op], "new"), [run]);

  const applyAll = useCallback(
    (ops: readonly BuilderOp[]) => run(ops, "new"),
    [run]
  );

  /**
   * Take the newest entry off one stack and replay it, recording what takes
   * it back on the other.
   *
   * Popped before running, and NOT pushed back on failure. A refused undo
   * means the inverse no longer applies to this document, so keeping it would
   * leave a step that fails every time it is reached — an undo button that
   * does nothing and never clears.
   */
  const replay = useCallback(
    (from: "undo" | "redo"): boolean | Promise<boolean> => {
      const entry = pop(from);
      if (entry === undefined) return false;
      const into = from === "undo" ? "redo" : "undo";
      if (entry.kind === "step") {
        return replayStep(entry, into, push, remove, settle);
      }
      return run(entry.ops, into) !== null;
    },
    [pop, push, remove, run, settle]
  );
  const undo = useCallback(() => replay("undo"), [replay]);
  const redo = useCallback(() => replay("redo"), [replay]);
  // Bounded and branch-ending exactly as a fresh document edit is.
  const recordStep = useCallback(
    (step: HistoryStep) => {
      const dropped = push({ kind: "step", step, origin: step }, "new");
      return () => withdraw(step, dropped);
    },
    [push, withdraw]
  );

  const select = useCallback(
    (id: string | null, mode: SelectionMode = "replace") =>
      setSelection(current =>
        applySelection(latestDocument.current, current, id, mode)
      ),
    []
  );

  return useMemo(
    () => ({
      document,
      selectedId: selection.primary,
      selection,
      select,
      apply,
      applyAll,
      lockRefusalFor,
      planRepair,
      composed,
      lockDefinitions,
      undo,
      redo,
      recordStep,
      canUndo: depths.undo > 0,
      canRedo: depths.redo > 0,
      limits,
      undoDepth: depths.document,
    }),
    [
      document,
      selection,
      select,
      apply,
      applyAll,
      lockRefusalFor,
      planRepair,
      composed,
      lockDefinitions,
      undo,
      redo,
      recordStep,
      depths,
      limits,
    ]
  );
}
