/**
 * Reading a document's envelope and walking its forest: the root reading,
 * the queue every node is checked from, where a block may sit (nesting,
 * placement and locked slots), and the breakpoint ids the site's settings
 * define.
 *
 * @module validation-forest
 */
import {
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
} from "./document";
import { describeValue, pointer } from "./issue-text";
import { MAX_NODES } from "./limits";
import { canBeRoot, canNest, canNestInSlot } from "./nesting";
import {
  type PlacementSources,
  placementTracker,
  type TrackedPlacement,
} from "./placement";
import { blockLabelFrom, placementRefusalMessage } from "./placement-wording";
import { isPlainRecord } from "./plain-record";
import {
  type ActiveSlotLock,
  slotLockBreaks,
  slotLockOf,
  typeOfChild,
} from "./slot-lock";
import { startingChildrenSource } from "./starting-children";
import {
  counterpartsOf,
  type StoredForms,
  storedFormsOf,
} from "./stored-counterparts";
import { breakpointContexts } from "./style/compile-page";
import {
  memoizeTokenLookup,
  newStyleIssueBudget,
} from "./style/validate-style-value";
import type { SlotDefaultSource } from "./tree";
import {
  isNodeType,
  type IssueSeverity,
  memoizeClassLookup,
  type ValidationContext,
  type ValidationIssue,
} from "./validation-contract";
import { type NodeCheckState, validateNode } from "./validation-node";
import { isConditionGated } from "./visibility";

/**
 * The one issue both root readings report.
 *
 * Two places decide a root is not a document — the coarse test before the
 * caller's settings are read, and the envelope's fuller reading after the
 * survey — and they say the same thing for the same reason. Written twice, the
 * two copies agree until someone improves the sentence in one of them, and an
 * author then reads a different message depending on which shape their document
 * happens to be broken in.
 */
export function invalidDocumentIssue(): ValidationIssue {
  return {
    path: "",
    code: "invalid-document",
    severity: "error",
    message: "The document must be an object.",
  };
}

/**
 * What the document's own envelope said, and whether there is a forest to walk.
 *
 * Its own function because it is a distinct question with a distinct answer:
 * "is this a document at all, and is its outer shape sound" is settled before
 * anything reads a node, and two of its outcomes end the whole validation.
 * Keeping it inline put those early returns in the middle of a function that
 * also holds the walk, which is what made the walk unreachable to a reader —
 * and to the complexity gate, which refuses any edit to a function this size.
 *
 * The order of the checks is the order of the issues, and it is load-bearing:
 * callers assert on the first issue, so a breakpoint fault must still precede a
 * format-version fault, and `nodes` must still be judged last.
 */
type DocumentEnvelope =
  | { readonly stop: true }
  | {
      readonly stop: false;
      /** The same value as the argument, established as a record. */
      readonly doc: Record<string, unknown>;
      /** Its `nodes`, established as an array. */
      readonly nodes: BlockNode[];
      /** As stored — validated above, and read again for the per-kind rules. */
      readonly kind: unknown;
    };

export function documentEnvelope(
  doc: BlockDocument,
  unknownSeverity: IssueSeverity,
  issues: ValidationIssue[]
): DocumentEnvelope {
  // A wholly-malformed document (null, an array, a primitive) is reported as a
  // structural issue rather than crashing on the field reads below. `rawDoc`
  // aliases the same value as `unknown`: reads through it are legitimately
  // untrusted, while `doc` keeps its declared type for the typed helper calls.
  const rawDoc: unknown = doc;
  if (!isPlainRecord(rawDoc)) {
    issues.push(invalidDocumentIssue());
    return { stop: true };
  }

  const formatVersion = rawDoc.formatVersion;
  if (formatVersion !== DOCUMENT_FORMAT_VERSION) {
    issues.push({
      path: "/formatVersion",
      code: "invalid-format-version",
      severity: "error",
      message: `Unsupported document formatVersion ${describeValue(formatVersion)}.`,
      suggestion: `Use formatVersion ${DOCUMENT_FORMAT_VERSION}.`,
    });
  }

  // An unrecognized kind STRING is preserved in forgiving mode (a warning) and
  // rejected in strict mode, matching the unknown-block-type policy. A missing
  // or non-string kind is structural corruption, not a future value to
  // preserve, so it is always an error.
  const kind = rawDoc.kind;
  if (!DOCUMENT_KINDS.includes(kind as (typeof DOCUMENT_KINDS)[number])) {
    issues.push({
      path: "/kind",
      code: "invalid-kind",
      severity: typeof kind === "string" ? unknownSeverity : "error",
      message: `Unknown document kind "${describeValue(kind)}".`,
      suggestion: `Use one of: ${DOCUMENT_KINDS.join(", ")}.`,
    });
  }

  if (!Array.isArray(rawDoc.nodes)) {
    issues.push({
      path: "/nodes",
      code: "nodes-not-array",
      severity: "error",
      message: "The document nodes field must be an array.",
    });
    // Nothing further to check without a node forest.
    return { stop: true };
  }

  return {
    stop: false,
    doc: rawDoc,
    nodes: rawDoc.nodes as BlockNode[],
    kind,
  };
}

/**
 * The state every node check shares, built once.
 *
 * Separated from the walk because it is configuration rather than traversal:
 * nothing here decides anything about a node, and reading it beside the loop
 * made the loop look like it depended on the order these were assembled in.
 */
export function nodeCheckState(
  ctx: ValidationContext,
  issues: ValidationIssue[],
  knownBreakpoints: Set<string>,
  unknownSeverity: IssueSeverity,
  bounds: { readonly overLimits: boolean }
): NodeCheckState {
  const styleBudget = newStyleIssueBudget();
  return {
    // Both site lookups are wrapped once here rather than per node or per style
    // envelope, so a name repeated across the document costs the caller one
    // answer for the whole walk. Nothing else bounds that repetition: a name
    // that RESOLVES produces no issue, so it is never charged the allowance
    // that stops the rest of the per-value work.
    ctx: {
      ...ctx,
      tokens: memoizeTokenLookup(ctx.tokens, styleBudget),
      classes: memoizeClassLookup(ctx.classes, styleBudget),
    },
    issues,
    knownBreakpoints,
    unknownSeverity,
    seenIds: new Map<string, string>(),
    seenDomIds: new Map<string, string>(),
    startingChildren:
      ctx.definitions === undefined
        ? undefined
        : startingChildrenSource(ctx.definitions, ctx.nesting),

    skipValueParsing: bounds.overLimits,
    styleBudget,
  };
}

/**
 * One node on the queue, with everything the check of it needs.
 *
 * THREE placement states, not a nullable type. "At the top level" and "inside a
 * container whose type is malformed" are different facts, and one absent value
 * standing for both makes a child in a slot answer the ROOT question — which
 * reports it as sitting nowhere while its own path says which slot holds it.
 */
export interface QueuedNode {
  node: BlockNode;
  path: string;
  placement: Placement;
  /**
   * True when an ancestor is condition-gated, so the renderer prunes this
   * node with it.
   *
   * Carried DOWN the queue rather than precomputed over the raw forest.
   * A separate walk would read every node's `visibility` and `slots` outside
   * this loop, which is the one place bounded by `maxNodes` — so an oversized
   * document would be traversed in full by the check meant to be capped.
   */
  hidden: boolean;
  /**
   * The lock of the slot this node sits in, or undefined when that slot fixes
   * nothing. Carried down the queue for the reason `hidden` is: a lock passes
   * to every slot beneath it that declares none, and reading each ancestor's
   * declaration again per node would walk outside the bounded loop.
   */
  lock: ActiveSlotLock | undefined;
  /**
   * The node as the document's stored forms hold it in this place, carried
   * down the queue for the reason `lock` is.
   */
  counterparts: readonly Readonly<Record<string, unknown>>[];
  /**
   * Where the node is stored: the list holding it, and the container and slot
   * that list belongs to (none at the top level). Read by a walk that moves
   * nodes, the repair planner, so it finds them where validation does.
   */
  siblings: unknown[];
  parent: BlockNode | undefined;
  slot: string | undefined;
}

/**
 * Check every node in the forest, and everything about where it sits.
 *
 * Iterative breadth-first. It never recurses, so a document nested arbitrarily
 * deep cannot overflow the call stack — validation returns the depth issue
 * instead of throwing. It also stops after visiting `maxNodes` nodes (the
 * node-count issue is already recorded by `checkLimits`), so an oversized
 * document cannot make the walk do unbounded work.
 *
 * Index-based reads (not `.map`/`.forEach`) so a sparse array's holes become
 * explicit `undefined` entries reported as invalid nodes, and the queue is
 * capped at `maxNodes` so an oversized forest cannot grow it without bound.
 */
export function validateNodeForest(
  nodes: BlockNode[],
  state: NodeCheckState,
  maxNodes: number
): void {
  // The placement rule needs the definitions as well as the nesting source:
  // declared slots and content models live there. A caller with only a
  // nesting source keeps the name rules it always had.
  const sources = placementSourcesOf(state.ctx);
  const placement =
    sources === undefined
      ? undefined
      : {
          tracker: placementTracker(sources),
          old: storedBreakSignatures(state.ctx.stored, sources, maxNodes),
        };
  walkNodeForest(
    nodes,
    maxNodes,
    { definitions: state.ctx.definitions, stored: state.ctx.stored },
    ({
      node,
      path,
      placement: at,
      hidden,
      lock,
      counterparts,
      parent,
      slot,
    }) => {
      // Asked HERE rather than in a pass of its own, so the read is inside the
      // budget and happens on a node this loop has reached. Gating is
      // inherited, because the renderer prunes a gated node's whole subtree.
      // `isPlainRecord` first: this walk accepts whatever the database
      // returned, and a `null` among the nodes reaches here. Reading
      // `visibility` off one throws, where the contract is an issue rather
      // than an exception — the same guard the slot walk applies.
      const gated = hidden || (isPlainRecord(node) && isConditionGated(node));
      validateNode(node, path, state, gated);
      if (placement === undefined) {
        checkNesting(node, path, at, state);
      } else {
        checkPlacement(
          node,
          path,
          at,
          placement.tracker.visit(node, parent, slot),
          placement.old,
          state
        );
      }
      checkLockedSlots(node, path, { lock, counterparts }, state);
      return gated;
    }
  );
}

/**
 * The forest walk, breadth-first, bounded by `maxNodes`: every node it
 * reaches, with where it sits, the lock its slot passes down and its stored
 * counterparts, handed to `visit`, which answers whether the node gates its
 * subtree.
 *
 * The ONE walk for every question about where a node sits. Validation's
 * checks visit it, and so do the editor's lock questions (`lock-breaks`), so
 * the two reach the same nodes under the same bounds and cannot disagree
 * about which lock breaks a document holds.
 */
export function walkNodeForest(
  nodes: BlockNode[],
  maxNodes: number,
  sources: {
    definitions: SlotDefaultSource | undefined;
    stored: readonly unknown[] | undefined;
  },
  visit: (queued: QueuedNode) => boolean
): void {
  const queue: QueuedNode[] = [];
  // Only a lock reads the stored forms, so there is nothing to index without
  // the definitions locks are declared in.
  const stored =
    sources.definitions === undefined
      ? undefined
      : storedFormsOf(sources.stored, maxNodes);
  for (let i = 0; i < nodes.length && queue.length <= maxNodes; i++) {
    queue.push({
      node: nodes[i],
      path: pointer("/nodes", i),
      placement: { at: "root" },
      hidden: false,
      // A top-level node sits in no slot, so no lock reaches it.
      lock: undefined,
      counterparts: counterpartsOf(nodes[i], undefined, stored),
      siblings: nodes,
      parent: undefined,
      slot: undefined,
    });
  }
  for (let i = 0; i < queue.length && i < maxNodes; i++) {
    const queued = queue[i];
    const gated = visit(queued);
    const { node, path, lock, counterparts } = queued;
    enqueueChildren(
      { node, path, gated, lock, counterparts },
      queue,
      maxNodes,
      { definitions: sources.definitions, stored }
    );
  }
}

/**
 * Put a node's slot children on the queue, each with the placement it inherits.
 *
 * Its own function because it answers a question the loop above does not: where
 * a child SITS, which needs the container's name and the slot it is in. Reading
 * that inline made the loop's own subject — one node, checked — hard to see
 * past two levels of nesting.
 */
function enqueueChildren(
  parent: {
    node: BlockNode;
    path: string;
    gated: boolean;
    lock: ActiveSlotLock | undefined;
    counterparts: readonly Readonly<Record<string, unknown>>[];
  },
  queue: QueuedNode[],
  maxNodes: number,
  sources: {
    definitions: SlotDefaultSource | undefined;
    stored: StoredForms | undefined;
  }
): void {
  const { node, path, gated } = parent;
  const { definitions, stored } = sources;
  if (!isPlainRecord(node) || !isPlainRecord(node.slots)) return;
  // The container's placement for every child beneath it, read once.
  //
  // `isNodeType`, NOT a `typeof` check, and they are not the same boundary:
  // `"columns"` and `"core/columns/"` are strings that no block can be
  // named, so a weaker guard admits them as container NAMES and a restricted
  // child is then refused against a name nothing could ever match. The
  // predicate used here is the one that decides `invalid-node-type`, so a
  // container reported as malformed is exactly a container this cannot name.
  //
  // Children are still walked and still checked for everything else. Only
  // the one question that needs the container's name is recorded as
  // unanswerable rather than answered from a name that does not exist.
  // The container's name, resolved once; the SLOT differs per iteration, so
  // the placement is built inside the loop. Hoisting it would carry one
  // slot's name to every sibling slot's children and check each against the
  // wrong allow-list — a refusal naming a slot the node is not in.
  const containerType = isNodeType(node.type) ? node.type : undefined;
  for (const [slot, children] of Object.entries(node.slots)) {
    const childPlacement: Placement =
      containerType === undefined
        ? { at: "unnameable-container" }
        : { at: "container", type: containerType, slot };
    if (!Array.isArray(children)) continue;
    const slotPath = pointer(pointer(path, "slots"), slot);
    const lock = slotLockOf(definitions, containerType, slot, parent.lock);
    for (let c = 0; c < children.length && queue.length <= maxNodes; c++) {
      queue.push({
        node: children[c],
        path: pointer(slotPath, c),
        placement: childPlacement,
        hidden: gated,
        lock,
        counterparts: counterpartsOf(
          children[c],
          {
            holders: parent.counterparts,
            slot,
            index: c,
            contentOnly: lock === "contentOnly",
          },
          stored
        ),
        siblings: children,
        parent: node,
        slot,
      });
    }
  }
}

/**
 * Where the walk reached a node from.
 *
 * `unnameable-container` is its own member rather than an absent type, because
 * the alternative — one nullable field for both "no container" and "a container
 * I cannot name" — makes the two indistinguishable at the point of use, and the
 * rule then answers the root question for a node that is plainly in a slot.
 */
type Placement =
  | { at: "root" }
  | { at: "container"; type: string; slot: string }
  | { at: "unnameable-container" };

/**
 * Report a node sitting somewhere its own definition does not permit.
 *
 * The rule is asked of `canNest`/`canBeRoot` rather than restated here, so the
 * canvas refusing a drag and this refusing a save cannot drift: one of them
 * would otherwise start permitting a placement the other writes, and a drag that
 * is refused leaves nothing behind to compare against.
 *
 * An ERROR in both modes. `parent` is the child stating where it is meaningful,
 * so a violation is a document that renders somewhere its author never said it
 * could — not a forward-compatible value to preserve, which is what the lenient
 * mode exists for.
 */
function checkNesting(
  node: BlockNode,
  path: string,
  placement: Placement,
  state: NodeCheckState
): void {
  const source = state.ctx.nesting;
  if (source === undefined) return;
  // A container this walk cannot name cannot be judged against. The container's
  // own malformed type is already reported, and answering anyway would mean
  // either inventing a name or treating a node in a slot as a root — the second
  // being the trap, because it produces a confident refusal saying the node
  // sits nowhere while its own path names the slot holding it.
  if (placement.at === "unnameable-container") return;
  // The same predicate the container is judged by, for the same reason. A
  // malformed type is reported by `validateNode`; asking the rule about it would
  // get "no restriction" back for a name no definition carries, which is a
  // confident answer to a question the document cannot pose.
  const raw: unknown = node;
  if (!isPlainRecord(raw) || !isNodeType(raw.type)) return;
  // Both halves, and the CHILD's first. Either refusal is enough, so the order
  // decides only which reason an author is shown, and "this block belongs
  // elsewhere" is the more actionable of the two — a slot refusal for a block
  // that never belonged under this parent describes the symptom rather than the
  // mistake.
  const verdict =
    placement.at === "root"
      ? canBeRoot(raw.type, source)
      : (() => {
          const child = canNest(raw.type, placement.type, source);
          if (!child.allowed) return child;
          return canNestInSlot(
            raw.type,
            placement.type,
            placement.slot,
            source
          );
        })();
  if (verdict.allowed) return;
  // The refusal's own reason IS the issue code, so a rule added to
  // `NestingRefusal` reaches the document already named rather than through a
  // mapping that answers for the members it was written with.
  state.issues.push({
    path,
    code: verdict.reason,
    severity: "error",
    // The one wording the editor uses too. Without definitions there is no
    // label to read, so a type reads as its name made readable.
    message: placementRefusalMessage(
      {
        allowed: false,
        reason: verdict.reason,
        blockType: raw.type,
        permitted: verdict.permitted,
      },
      {
        labelOf: type => blockLabelFrom(type, undefined),
        ...(placement.at === "container" ? { regionType: placement.type } : {}),
      }
    ),
  });
}

/** The placement rule's sources, when the context carries both halves. */
function placementSourcesOf(
  ctx: ValidationContext
): PlacementSources | undefined {
  if (ctx.nesting === undefined || ctx.definitions === undefined) {
    return undefined;
  }
  return { nesting: ctx.nesting, definitions: ctx.definitions };
}

/**
 * The signatures of every placement break the stored forms already hold.
 *
 * Judged by the same tracker over the same bounded walk as the document, so a
 * break the stored page held reads as the same break here, and a break is old
 * exactly when its block sits under the same chain of ancestors, unchanged
 * (`TrackedPlacement.signature`). Empty without stored forms: a document never
 * stored has no old breaks.
 */
export function storedBreakSignatures(
  stored: readonly unknown[] | undefined,
  sources: PlacementSources,
  maxNodes: number = MAX_NODES
): ReadonlySet<string> {
  const found = new Set<string>();
  for (const form of stored ?? []) {
    const nodes = isPlainRecord(form) ? form.nodes : undefined;
    if (!Array.isArray(nodes)) continue;
    const tracker = placementTracker(sources);
    walkNodeForest(
      nodes as BlockNode[],
      maxNodes,
      { definitions: undefined, stored: undefined },
      ({ node, parent, slot }) => {
        const tracked = tracker.visit(node, parent, slot);
        if (tracked !== undefined && !tracked.verdict.allowed) {
          found.add(tracked.signature);
        }
        return false;
      }
    );
  }
  return found;
}

/**
 * Report a node the placement rule refuses where it sits.
 *
 * An ERROR when the break is new, and a WARNING when a stored form already
 * held it: a page saved before the rule must still save its other changes
 * without losing or refusing those blocks, and the editor offers a repair.
 * Worded by the one wording the editor uses, so an author reads the same
 * sentence from the canvas and from a save.
 */
function checkPlacement(
  node: BlockNode,
  path: string,
  placement: Placement,
  tracked: TrackedPlacement | undefined,
  old: ReadonlySet<string>,
  state: NodeCheckState
): void {
  // As `checkNesting`: a container this walk cannot name cannot be judged.
  if (placement.at === "unnameable-container") return;
  const raw: unknown = node;
  if (!isPlainRecord(raw) || !isNodeType(raw.type)) return;
  if (tracked === undefined || tracked.verdict.allowed) return;
  const definitions = state.ctx.definitions;
  state.issues.push({
    path,
    code: tracked.verdict.reason,
    severity: old.has(tracked.signature) ? "warning" : "error",
    message: placementRefusalMessage(tracked.verdict, {
      labelOf: type => blockLabelFrom(type, definitions?.get(type)),
      ...(placement.at === "container" ? { regionType: placement.type } : {}),
    }),
  });
}

/**
 * Report a locked slot that does not hold the blocks it starts with.
 *
 * Asked of every slot the container's type DECLARES rather than only the ones
 * the node stores. Removing a slot's last child can leave no slot stored at
 * all, and that is exactly the arrangement a lock refuses when the slot starts
 * with something.
 *
 * An ERROR in both modes, as a nesting violation is. The lock is the block
 * author stating which children this slot holds, so a document holding others
 * is not a forward-compatible value to preserve.
 */
function checkLockedSlots(
  node: BlockNode,
  path: string,
  at: {
    lock: ActiveSlotLock | undefined;
    counterparts: readonly Readonly<Record<string, unknown>>[];
  },
  state: NodeCheckState
): void {
  const definitions = state.ctx.definitions;
  const startingChildren = state.startingChildren;
  if (definitions === undefined || startingChildren === undefined) return;
  // A malformed node is the node check's to report; it has no slots to judge.
  const raw: unknown = node;
  if (!isPlainRecord(raw)) return;
  const type = raw.type;
  const breaks = slotLockBreaks(
    node,
    at.lock,
    definitions,
    startingChildren,
    at.counterparts
  );
  for (const found of breaks) {
    const slotPath = pointer(pointer(path, "slots"), found.slot);
    state.issues.push(
      found.kind === "membership"
        ? lockedSlotIssue(
            { ...found, type: String(type) },
            // The slot when it is stored; the node when it is not, because a
            // pointer has to resolve against the document it reports on.
            found.stored ? slotPath : path
          )
        : contentOnlyIssue(
            { ...found, type: String(type) },
            pointer(slotPath, found.index)
          )
    );
  }
}

/** The issue for a child of a `"contentOnly"` slot that changed besides content. */
function contentOnlyIssue(
  found: {
    type: string;
    slot: string;
    childType: string;
    changes: readonly string[];
    content: ReadonlySet<string>;
  },
  path: string
): ValidationIssue {
  return {
    path,
    code: "locked-slot-content-only",
    severity: "error",
    message: `The "${describeValue(found.slot)}" slot of a "${describeValue(found.type)}" is locked "contentOnly", so only the content of its "${describeValue(found.childType)}" may change. Its ${found.changes.join(", ")} changed.`,
    suggestion:
      found.content.size === 0
        ? "Put this block back as it started. It declares no content, so nothing about it can change here."
        : `Put back everything but its content. Only ${[...found.content].map(name => `"${name}"`).join(", ")} can change here.`,
  };
}

/** At most this many block types are named in one message; the rest are counted. */
const MOST_TYPES_NAMED = 8;

/** A list of block types, as an issue message names them. */
function namedTypes(
  types: readonly (string | undefined)[],
  total: number
): string {
  const named = types
    .slice(0, MOST_TYPES_NAMED)
    .map(type =>
      type === undefined ? "a malformed node" : `"${describeValue(type)}"`
    );
  const unnamed = total - named.length;
  return unnamed > 0
    ? `${named.join(", ")} and ${unnamed} more`
    : named.join(", ");
}

/** Whether the order of a slot's blocks is part of what its lock fixes. */
function orderClause(lock: ActiveSlotLock, starting: number): string {
  if (starting < 2) return "";
  return lock === "insert" ? ", in any order" : ", in that order";
}

/**
 * The issue for a locked slot holding other blocks than it starts with.
 *
 * Names what the slot must hold as well as what it does, because the repair is
 * to put the starting blocks back, and an author told only that the slot is
 * wrong has to find out which blocks it started with.
 */
function lockedSlotIssue(
  found: {
    type: string;
    slot: string;
    lock: ActiveSlotLock;
    starting: readonly string[];
    held: readonly unknown[];
  },
  path: string
): ValidationIssue {
  const { type, slot, lock, starting, held } = found;
  const requires =
    starting.length === 0 ? "no blocks" : namedTypes(starting, starting.length);
  const holds =
    held.length === 0
      ? "none"
      : namedTypes(
          held.slice(0, MOST_TYPES_NAMED).map(typeOfChild),
          held.length
        );
  return {
    path,
    code: "locked-slot-altered",
    severity: "error",
    message: `The "${describeValue(slot)}" slot of a "${describeValue(type)}" is locked "${lock}", so it holds ${requires}${orderClause(lock, starting.length)}. It holds ${holds}.`,
    suggestion:
      lock === "insert"
        ? "Put back the blocks this slot starts with. They can be reordered, but not added or removed."
        : "Put back the blocks this slot starts with, in their order. They cannot be added, removed or reordered.",
  };
}

/**
 * Collect every breakpoint id, reporting any id that repeats — whether within a
 * single axis or across the two. This is the one check about the CONTEXT rather
 * than the document: its issue path (`/breakpoints/<axis>/<i>`) points into the
 * supplied breakpoint set, not the validated document, because a duplicate id
 * is a site-settings problem that makes every flat style breakpoint key
 * ambiguous.
 */
export function collectBreakpointIds(
  breakpoints: BreakpointSet,
  issues: ValidationIssue[]
): Set<string> {
  const ids = new Set<string>();
  // The breakpoint set comes from stored settings, so treat it as untrusted: a
  // null/malformed set or axis is skipped rather than dereferenced.
  const set: unknown = breakpoints;
  const scanAxis = (axis: "viewport" | "container"): void => {
    const defs = isPlainRecord(set) ? set[axis] : undefined;
    if (!Array.isArray(defs)) return;
    defs.forEach((def, index) => {
      // A malformed definition (null, missing id) contributes no usable
      // breakpoint id, so it is skipped rather than dereferenced.
      const rawDef: unknown = def;
      if (!isPlainRecord(rawDef) || typeof rawDef.id !== "string") return;
      const id = rawDef.id;
      if (ids.has(id)) {
        issues.push({
          path: pointer(pointer("/breakpoints", axis), index),
          code: "breakpoint-id-not-unique",
          severity: "error",
          message: `Breakpoint id "${describeValue(id)}" is defined more than once.`,
          suggestion: "Give every breakpoint a unique id across both axes.",
        });
      }
      ids.add(id);
    });
  };
  scanAxis("viewport");
  scanAxis("container");
  // REPORTED above, DERIVED here. The scan exists to tell an author about a
  // duplicate id; which ids this site actually defines is a different question,
  // and the compiler is the only thing that answers it. Returning the scanned
  // set made validation and compilation disagree about the same document: a
  // definition the compiler drops — an unusable bound, a viewport entry with no
  // bound at all, a duplicate past the first, one past the per-axis cap, or an
  // id longer than it will read — was counted as known here, so styles keyed to
  // it validated with no issue and then compiled to nothing, reported only as an
  // unknown breakpoint by a pass the author never ran.
  //
  // It also answers the opposite case: `breakpointContexts` always carries the
  // base context, so styles keyed to `base` are known even when the stored set
  // names no base definition — which the scan alone got wrong in the direction
  // of reporting a value that compiles perfectly well.
  return new Set(breakpointContexts(breakpoints).map(context => context.id));
}
