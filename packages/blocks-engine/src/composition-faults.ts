/**
 * What a COMPOSED document breaks that none of its stored documents breaks alone.
 *
 * Validation judges one stored document at a time. A page holding an instance
 * sees one node of the instance type, and a definition is judged with its roots
 * at the top level of nothing — so two rules go unjudged wherever a component is
 * placed:
 *
 * - **Nesting across the placement.** A definition's roots land in whatever slot
 *   the instance sits in, and page content an instance supplies lands inside a
 *   node of the definition. Whether either may sit there is a question about the
 *   composed tree, and only the composed tree can answer it.
 * - **Depth from the document's own root.** The resolver measures a definition
 *   from the definition's own root, and the page's slot content from where the
 *   page stores it. The tree a reader receives is deeper than either says, and a
 *   tree past the limit is cut short where the renderer's own bound stops.
 *
 * So this reads the composition the RENDERER receives — the output of
 * `resolveComponentInstances`, the same computation over the same inputs — and
 * reports only what the composition introduced. A fault among the host's own
 * nodes is the host's validation's to report; repeating it here would give one
 * defect two verdicts.
 *
 * Every fault names the HOST's own instance, the placement its author made. A
 * component nested inside another is replaced by the tree it stands for, so its
 * own node is nothing an author can select — `instanceOf` names the host's
 * instance at every depth for the same reason, and this follows it.
 *
 * The nesting rule itself is not restated: each node is asked of
 * `placementVerdict`, the one implementation the canvas and the validator both
 * use.
 *
 * @module composition-faults
 */
import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { describeValue } from "./issue-text";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import {
  placementVerdict,
  type NestingRefusal,
  type NestingSource,
  type PlacementTarget,
} from "./nesting";
import { isPlainRecord } from "./plain-record";
import type {
  ResolvedBlockNode,
  ResolvedComposition,
} from "./resolve-instances";
import { boundedOwnKeys, ownEntry } from "./safe-record";
import {
  slotLockBreaks,
  slotLockOf,
  typeOfChild,
  type ActiveSlotLock,
  type LockBreak,
} from "./slot-lock";
import { startingChildrenSource } from "./starting-children";
import {
  counterpartsOf,
  storedFormsOf,
  type StoredForms,
} from "./stored-counterparts";
import { walkNodes, type SlotDefaultSource } from "./tree";
import { isNodeType } from "./validation";

/** Which rule a composition breaks. */
export type CompositionFaultCode =
  | NestingRefusal
  /** The composed tree is deeper than `limits.maxDepth`, counted from its root. */
  | "depth-exceeded"
  /** The resolver refused an instance for nesting components too deeply. */
  | "composed-depth"
  /** The resolver refused an instance whose definition alone is too deep. */
  | "node-depth"
  /** A locked slot in the composed tree does not hold the blocks it starts with. */
  | "locked-slot-altered"
  /** A block in a `"contentOnly"` slot of the composed tree changed besides content. */
  | "locked-slot-content-only";

/** One thing a composition breaks, and the placement it is reached through. */
export interface CompositionFault {
  readonly code: CompositionFaultCode;
  /** The HOST document's own instance node the fault is reached through. */
  readonly instanceId: string;
  /** The component that instance places; empty when it names none. */
  readonly componentId: string;
  readonly message: string;
  /**
   * For a lock break, where it is in the composed tree and what it breaks, so
   * an editor that refuses the edit first can word it, and tell a break the
   * edit adds from one the page already had. Absent for every other rule.
   */
  readonly lock?: ComposedLockBreak;
}

/** A lock break in the composed tree: the block whose slot is locked, and how. */
export interface ComposedLockBreak {
  /** The composed node holding the locked slot: a definition's node, as composed. */
  readonly holderId: string;
  readonly holderType: string;
  readonly slot: string;
  readonly lock: ActiveSlotLock;
  /** For a `"contentOnly"` break, the child whose design changed. */
  readonly childType?: string;
  /** For a `"contentOnly"` break, what about it changed; empty otherwise. */
  readonly changes: readonly string[];
  /**
   * For a membership break, the type of each block the slot holds in the
   * composed tree, in order, as far as the node cap, and how many it holds;
   * empty and 0 otherwise. What tells a further change to a slot already
   * broken from leaving it as it was.
   */
  readonly held: readonly (string | undefined)[];
  readonly heldCount: number;
}

/** What the judgement is measured against. */
export interface CompositionFaultOptions {
  /** The caps the composition was resolved under. Defaults to {@link DEFAULT_LIMITS}. */
  limits?: DocumentLimits;
  /** The site's nesting rules. Absent, nesting is not judged — as for validation. */
  nesting?: NestingSource;
  /**
   * The block definitions, for the locks their slots declare. Absent, locks
   * are not judged, as for validation.
   */
  definitions?: SlotDefaultSource;
  /**
   * Composed documents whose values a `"contentOnly"` lock lets this one keep:
   * the host's stored forms composed, and the host with each placement as its
   * component holds it. A part one of them already holds at the same place is
   * no change (`stored-counterparts`). Absent, every locked slot is measured
   * against its starting children alone.
   */
  baselines?: readonly unknown[];
}

/**
 * The resolver's refusals that are judgements about depth.
 *
 * The others are not faults of the composition. `missing` and `unreadable` draw
 * a placeholder the author can act on where it shows; `cycle` is refused where
 * the loop is written, on the component; `malformed` is the host's own
 * validation's; and `budget` is a size the resolver already bounds.
 */
const DEPTH_REFUSALS: ReadonlySet<string> = new Set([
  "composed-depth",
  "node-depth",
]);

/** One node of the composed tree, with what judging it needs. */
interface Visit {
  readonly node: unknown;
  readonly depth: number;
  readonly where: PlacementTarget;
  /** Whether the node's container came from a definition. */
  readonly containerComposed: boolean;
  /** The host instance this node is reached through, once composition began. */
  readonly through: string | undefined;
  /** The lock of the slot this node sits in, or undefined where none applies. */
  readonly lock: ActiveSlotLock | undefined;
  /** The node as the baselines hold it in this place. */
  readonly counterparts: readonly Readonly<Record<string, unknown>>[];
}

/** What every visit reports into, built once per judgement. */
interface Judge {
  readonly limits: DocumentLimits;
  readonly nesting: NestingSource | undefined;
  readonly definitions: SlotDefaultSource | undefined;
  readonly startingChildren:
    | ((type: string, slot: string) => readonly BlockNode[])
    | undefined;
  readonly baselines: StoredForms | undefined;
  report(code: CompositionFaultCode, instanceId: string, detail: Detail): void;
}

/**
 * Every fault the composition introduced, in document order, one per placement
 * and rule.
 *
 * `host` is the stored document `composition` was resolved from; it supplies the
 * component each of its instances names, which the composed tree no longer holds.
 */
export function compositionFaults(
  host: BlockDocument,
  composition: ResolvedComposition,
  options: CompositionFaultOptions = {}
): readonly CompositionFault[] {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const placed = componentsPlacedBy(host, limits);
  const faults: CompositionFault[] = [];
  const reported = new Set<string>();
  const definitions = options.definitions;
  const judge: Judge = {
    limits,
    nesting: options.nesting,
    definitions,
    startingChildren:
      definitions === undefined
        ? undefined
        : startingChildrenSource(definitions, options.nesting),
    baselines:
      definitions === undefined
        ? undefined
        : storedFormsOf(options.baselines, limits.maxNodes),
    report: (code, instanceId, detail) => {
      // One per placement and rule: a definition breaking a rule at forty nodes
      // is one thing for its author to fix, and forty messages spend the field's
      // issue allowance on the same repair. A lock is per SLOT, though: two
      // locked slots broken are two repairs, and one hidden behind the other
      // would let a save that breaks a second pass as no worse.
      const key = `${code}\u0000${instanceId}\u0000${detail.holder ?? ""}\u0000${detail.slot ?? ""}`;
      if (reported.has(key)) return;
      reported.add(key);
      const componentId = placed.get(instanceId) ?? "";
      faults.push({
        code,
        instanceId,
        componentId,
        message: messageFor(code, componentId, detail, limits),
        ...(detail.lockBreak === undefined ? {} : { lock: detail.lockBreak }),
      });
    },
  };

  const nodes = composition.document.nodes;
  if (!Array.isArray(nodes)) return faults;
  const pending: Visit[] = nodes.map(node => ({
    node,
    depth: 1,
    where: { kind: "root" },
    containerComposed: false,
    through: undefined,
    // A top-level node sits in no slot, so no lock reaches it.
    lock: undefined,
    counterparts: counterpartsOf(node, undefined, judge.baselines),
  }));
  // Bounded by the document cap. The resolver holds a composition to it, so on
  // its output this never cuts the walk short; it stands for a caller handing in
  // a composition built some other way, where an unbounded walk is the failure.
  for (
    let head = 0;
    head < pending.length && head < limits.maxNodes;
    head += 1
  ) {
    judgeVisit(pending[head], judge, pending);
  }
  return faults;
}

/** Judge one node of the composed tree, and queue what lies beneath it. */
function judgeVisit(visit: Visit, judge: Judge, pending: Visit[]): void {
  const raw = visit.node;
  if (!isPlainRecord(raw) || !isNodeType(raw.type)) return;
  const node = raw as unknown as ResolvedBlockNode;
  const composed = typeof node.instanceOf === "string";
  const through = composed ? node.instanceOf : visit.through;

  reportDepthRefusal(node, through, judge);
  // Past the limit the reader's tree is cut, and nothing beneath is worth
  // judging. A host's OWN depth is its validation's, so only a path running
  // through composed content is reported.
  if (visit.depth > judge.limits.maxDepth) {
    if (through !== undefined) judge.report("depth-exceeded", through, {});
    return;
  }
  if (through !== undefined) {
    reportComposedRules(node, visit, { composed, through }, judge);
  }
  enqueueSlots(node, visit, { composed, through }, judge, pending);
}

/**
 * The resolver's own depth refusal, where it left an instance standing.
 *
 * A host instance left standing is the host's own node, so it names its
 * placement by its own id; one standing inside a definition carries the host's
 * instance like every other composed node.
 */
function reportDepthRefusal(
  node: ResolvedBlockNode,
  through: string | undefined,
  judge: Judge
): void {
  const refused = node.unresolvedComponent;
  if (refused === undefined || !DEPTH_REFUSALS.has(refused)) return;
  judge.report(refused as CompositionFaultCode, through ?? node.id, {});
}

/** The nesting rule for one composed node, asked of the one implementation. */
function reportNesting(
  node: ResolvedBlockNode,
  where: PlacementTarget,
  through: string,
  judge: Judge
): void {
  if (judge.nesting === undefined) return;
  const verdict = placementVerdict([node.type], where, judge.nesting);
  if (verdict.allowed) return;
  judge.report(verdict.reason, through, {
    type: node.type,
    where,
    permitted: verdict.permitted,
  });
}

/**
 * The rules only the composed tree can answer, for a node reached through a
 * placement. Only where composition put the node or its container: a fault
 * among the host's own nodes is the host's validation's to report.
 */
function reportComposedRules(
  node: ResolvedBlockNode,
  visit: Visit,
  reached: { composed: boolean; through: string },
  judge: Judge
): void {
  if (reached.composed || visit.containerComposed) {
    reportNesting(node, visit.where, reached.through, judge);
  }
  // A node a definition put here: its locked slots hold what the placement
  // wrote into them, its values and its slot content, which neither the page
  // nor the component shows on its own.
  //
  // And a node the PLACEMENT supplied, once it sits inside a locked slot of
  // the definition: its own slots inherit that lock, so content it holds is
  // held to it as much as the definition's own.
  if (reached.composed || visit.lock !== undefined) {
    reportLockBreaks(node, visit, reached.through, judge);
  }
}

/** Each way a composed node's locked slots break their locks. */
function reportLockBreaks(
  node: ResolvedBlockNode,
  visit: Visit,
  through: string,
  judge: Judge
): void {
  if (judge.definitions === undefined || judge.startingChildren === undefined) {
    return;
  }
  const breaks = slotLockBreaks(
    node,
    visit.lock,
    judge.definitions,
    judge.startingChildren,
    visit.counterparts
  );
  for (const found of breaks) {
    const lockBreak = composedBreakOf(node, found, judge.limits.maxNodes);
    judge.report(
      found.kind === "membership"
        ? "locked-slot-altered"
        : "locked-slot-content-only",
      through,
      {
        type: found.kind === "content" ? found.childType : node.type,
        slot: found.slot,
        holder: node.id,
        holderType: node.type,
        lock: lockBreak.lock,
        changes: lockBreak.changes,
        lockBreak,
      }
    );
  }
}

/**
 * A break in the composed tree as a fault carries it. The blocks a slot holds
 * are read as far as the node cap, beside how many it holds.
 */
function composedBreakOf(
  node: ResolvedBlockNode,
  found: LockBreak,
  maxNodes: number
): ComposedLockBreak {
  if (found.kind === "content") {
    return {
      holderId: node.id,
      holderType: node.type,
      slot: found.slot,
      lock: "contentOnly",
      childType: found.childType,
      changes: found.changes,
      held: [],
      heldCount: 0,
    };
  }
  return {
    holderId: node.id,
    holderType: node.type,
    slot: found.slot,
    lock: found.lock,
    changes: [],
    held: found.held.slice(0, maxNodes).map(typeOfChild),
    heldCount: found.held.length,
  };
}

/** Queue a node's slot children, each with where it sits. */
function enqueueSlots(
  node: ResolvedBlockNode,
  visit: Visit,
  reached: { composed: boolean; through: string | undefined },
  judge: Judge,
  pending: Visit[]
): void {
  const { composed, through } = reached;
  const slots: unknown = node.slots;
  if (!isPlainRecord(slots)) return;
  const names = boundedOwnKeys(slots, Number.MAX_SAFE_INTEGER) ?? [];
  for (const slot of names) {
    const children = ownEntry(slots, slot);
    if (!Array.isArray(children)) continue;
    const lock = slotLockOf(judge.definitions, node.type, slot, visit.lock);
    children.forEach((child: unknown, index) => {
      pending.push({
        node: child,
        depth: visit.depth + 1,
        where: { kind: "slot", parentType: node.type, slot },
        containerComposed: composed,
        through,
        lock,
        counterparts: counterpartsOf(
          child,
          {
            holders: visit.counterparts,
            slot,
            index,
            contentOnly: lock === "contentOnly",
          },
          judge.baselines
        ),
      });
    });
  }
}

/** Which component each of the host's own instances names. */
function componentsPlacedBy(
  host: BlockDocument,
  limits: DocumentLimits
): ReadonlyMap<string, string> {
  const placed = new Map<string, string>();
  if (!Array.isArray(host.nodes)) return placed;
  walkNodes(
    host.nodes,
    node => {
      if (node.type !== COMPONENT_INSTANCE_TYPE) return;
      const id = isPlainRecord(node.props) ? node.props.componentId : undefined;
      if (typeof id === "string") placed.set(node.id, id);
    },
    { maxNodes: limits.maxNodes }
  );
  return placed;
}

/** What a nesting refusal says about where the block landed. */
interface Detail {
  readonly type?: string;
  readonly where?: PlacementTarget;
  readonly permitted?: readonly string[];
  /** The locked slot, for a lock break, and the node that declares it, by id and type. */
  readonly slot?: string;
  readonly holder?: string;
  readonly holderType?: string;
  readonly lock?: ActiveSlotLock;
  /** What a block in a `"contentOnly"` slot changed besides content. */
  readonly changes?: readonly string[];
  /** For a lock break, the break as a fault carries it. */
  readonly lockBreak?: ComposedLockBreak;
}

/** What every message is built from, worked out once. */
interface MessageParts {
  readonly named: string;
  readonly type: string;
  readonly parent: string;
  readonly permitted: string;
  readonly maxDepth: number;
  readonly slot: string;
  readonly holderType: string;
  readonly lock: string;
  readonly changes: string;
}

/**
 * One sentence per rule, each naming the component and the author's next action.
 *
 * A table keyed by the code rather than a branch per code, so a code added to
 * {@link CompositionFaultCode} without a sentence fails to compile here.
 */
const MESSAGES: Readonly<
  Record<CompositionFaultCode, (parts: MessageParts) => string>
> = {
  "restricted-at-root": m =>
    `${m.named} puts a "${m.type}" at the top level here, but it may only sit inside ${m.permitted}.`,
  "wrong-parent": m =>
    `${m.named} puts a "${m.type}" inside "${m.parent}" here, but it may only sit inside ${m.permitted}.`,
  "not-allowed-in-slot": m =>
    `${m.named} puts a "${m.type}" where its "${m.parent}" does not accept one. That place accepts ${m.permitted}.`,
  "depth-exceeded": m =>
    `${m.named} nests content deeper than the maximum of ${m.maxDepth} levels here, counted from the top of this document. Place it higher up, or flatten its content.`,
  "composed-depth": m =>
    `${m.named} places components inside components more deeply than is allowed. Flatten the components it places.`,
  "node-depth": m =>
    `${m.named} holds content nested deeper than the maximum of ${m.maxDepth} levels. Flatten its content.`,
  "locked-slot-altered": m =>
    `${m.named} has the "${m.slot}" slot of a "${m.holderType}" locked "${m.lock}", which holds exactly the blocks it starts with, and this placement changes them. Give that slot exactly the blocks it starts with on this placement, or leave it to the component.`,
  "locked-slot-content-only": m =>
    `${m.named} has the "${m.slot}" slot of a "${m.holderType}" locked "contentOnly", where only content can change, and this placement changes its "${m.type}"'s ${m.changes}. Reset those values on this placement.`,
};

/** The sentence for one fault. */
function messageFor(
  code: CompositionFaultCode,
  componentId: string,
  detail: Detail,
  limits: DocumentLimits
): string {
  return MESSAGES[code]({
    named:
      componentId === ""
        ? "A component"
        : `Component "${describeValue(componentId)}"`,
    type: describeValue(detail.type),
    parent:
      detail.where?.kind === "slot"
        ? describeValue(detail.where.parentType)
        : "",
    permitted: (detail.permitted ?? [])
      .map(name => `"${describeValue(name)}"`)
      .join(" or "),
    maxDepth: limits.maxDepth,
    slot: describeValue(detail.slot),
    holderType: describeValue(detail.holderType),
    lock: detail.lock ?? "",
    changes: (detail.changes ?? []).join(", "),
  });
}
