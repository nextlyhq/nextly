import {
  conditionScopeIn,
  declaresNoMarkup,
  DOCUMENT_FORMAT_VERSION,
  evaluateConditions,
  isConditionGated,
  revealConditioned,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
  type ConditionDayStart,
  type ConditionIssue,
  type ConditionScope,
  type ConditionSubject,
} from "@nextlyhq/blocks-engine";

import { conditionDayStart } from "./blocks/list-read";
import { queryRowFields } from "./blocks/named-read";
import type { PageBindings, PageContext } from "./context";
import type { BlockResolver } from "./resolver";

/**
 * Whether a node is shown regardless of the entry it renders against.
 *
 * The document format is explicit that conditionally hidden nodes are OMITTED
 * from server output rather than hidden with CSS, so a node carrying conditions
 * must not reach the page unless something has decided they hold. Nothing here
 * can decide that: a `Condition` is `{ field, op, value }` with `op` an open
 * string, and the engine defines no evaluator for it.
 *
 * So this fails CLOSED. Conditions gate personalised and status-restricted
 * content, and showing everyone what was meant for some of them is the failure
 * that cannot be taken back; content missing from a page is visible and
 * reportable. When the evaluator arrives this becomes a call into it.
 *
 * The predicate itself lives in the engine and is NOT restated here. The style
 * compiler asks the same question about the same node — whether to hold its
 * rules out of the sheet — and while the two derived it separately they
 * disagreed in both directions: on `conditions: [[]]` this served a node whose
 * rules the compiler had withheld, and on an unreadable shape this withheld a
 * node whose rules the compiler left in a sheet served to everyone. The second
 * published the assets of a block deliberately hidden, which is the leak the
 * gate exists to prevent. One function cannot disagree with itself.
 */
export function isUnconditional(node: BlockNode): boolean {
  return !isConditionGated(node);
}

/**
 * Removes condition-gated nodes from a document before anything reads it.
 *
 * Done to the DOCUMENT rather than while rendering, because the tree is read
 * twice: once to render HTML and once to compile the stylesheet. Filtering only
 * the render left a gated node's scoped CSS in the page — a background image
 * URL, a font, whatever the design carried — so the markup was withheld while
 * the assets it referenced were still announced. "Omitted from server output"
 * has to mean both, and the only way to be sure they agree is to give them the
 * same tree.
 *
 * Returns the ORIGINAL document when nothing is gated, so the ordinary page
 * allocates nothing.
 */
export function pruneHiddenNodes(document: BlockDocument): BlockDocument {
  return pruneNodes(document, isUnconditional);
}

/**
 * Removes every node `keep` rejects, and its subtree with it.
 *
 * Three passes drop nodes from a tree before it is read, for three different
 * reasons — a visibility condition, a block that declares its props draw
 * nothing, and a node that will resolve to a placeholder. What they drop differs;
 * HOW they drop it must not, because the caller compares the result by IDENTITY
 * to decide whether a stored stylesheet still describes the tree that renders. A
 * pass that returned a fresh document when it had removed nothing would read as
 * a repair and withhold the sheet, and one that returned its input after
 * removing something would publish rules for markup that is gone.
 *
 * Dropping the subtree is not a shortcut in any of the three. A node that is not
 * served places none of the children it was holding, so leaving them behind
 * would keep rules for markup that had nowhere to appear.
 *
 * Returns the ORIGINAL document when nothing was removed, so the ordinary page
 * allocates nothing.
 */
export function pruneNodes(
  document: BlockDocument,
  keep: (node: BlockNode) => boolean
): BlockDocument {
  return pruneNodesIn(
    document,
    undefined,
    node => keep(node),
    () => undefined
  );
}

/**
 * {@link pruneNodes}, with each node judged in the scope it sits in: `within`
 * says what a child of a node, in one of its slots, sits in. The one pruning
 * walk, so a pass that needs to know where a node sits drops it exactly as
 * the others do.
 */
function pruneNodesIn<Scope>(
  document: BlockDocument,
  root: Scope,
  keep: (node: BlockNode, scope: Scope) => boolean,
  within: (node: BlockNode, slot: string, scope: Scope) => Scope
): BlockDocument {
  return rewriteNodesIn(
    document,
    root,
    (node, scope) => (keep(node, scope) ? { node, descend: true } : null),
    within
  );
}

/**
 * What a rewrite does with one node: drop it (`null`), or put `node` in its
 * place, walking on into the slots of the node put there when `descend` says
 * so and leaving it whole when it doesn't.
 */
type Rewrite = { readonly node: BlockNode; readonly descend: boolean } | null;

/**
 * The walk every pruning and marking pass takes: each node visited with the
 * scope its conditions read, dropped, kept or replaced as `visit` says.
 * Returns the ORIGINAL document when nothing changed, as `pruneNodes` does.
 */
function rewriteNodesIn<Scope>(
  document: BlockDocument,
  root: Scope,
  visit: (node: BlockNode, scope: Scope) => Rewrite,
  within: (node: BlockNode, slot: string, scope: Scope) => Scope
): BlockDocument {
  let changed = false;

  const rewrite = (nodes: BlockNode[], scope: Scope): BlockNode[] => {
    const kept: BlockNode[] = [];
    for (const node of nodes) {
      const result = visit(node, scope);
      if (result === null) {
        changed = true;
        continue;
      }
      if (result.node !== node) changed = true;
      kept.push(
        result.descend ? withSlotsRewritten(result.node, scope) : result.node
      );
    }
    return changed ? kept : nodes;
  };

  /** `node` with each slot's children rewritten in the scope they read. */
  const withSlotsRewritten = (node: BlockNode, scope: Scope): BlockNode => {
    if (node.slots === undefined) return node;
    let slotsChanged = false;
    const nextSlots: Record<string, BlockNode[]> = {};
    for (const [name, children] of Object.entries(node.slots)) {
      const rewritten = rewrite(children, within(node, name, scope));
      if (rewritten !== children) slotsChanged = true;
      nextSlots[name] = rewritten;
    }
    return slotsChanged ? { ...node, slots: nextSlots } : node;
  };

  const nodes = rewrite(document.nodes, root);
  return changed ? { ...document, nodes } : document;
}

/**
 * What a page's conditions are decided against once its entry is known.
 *
 * @experimental
 */
export interface ConditionGate {
  /**
   * The entry the page shows, its fields and values as the public reads them.
   * Absent when the page has none, and every condition on it fails closed.
   */
  readonly entry?: ConditionSubject;
  /** When a day starts, for a condition ordering a date; UTC when absent. */
  readonly dayStart?: ConditionDayStart;
}

/**
 * A document gated by its entry, the blocks whose conditions held, and what
 * could not be checked.
 *
 * @experimental
 */
export interface GatedDocument {
  readonly document: BlockDocument;
  /** The entry-scoped blocks kept because their conditions held, by id. */
  readonly held: ReadonlySet<string>;
  readonly issues: readonly ConditionIssue[];
}

/**
 * Removes every block whose conditions read the page's entry and do not hold
 * for it, or cannot be checked, and names the blocks whose conditions held.
 *
 * A block in a list's per-entry slot is left in place: its conditions read
 * the list's item, which only the list knows as it draws each one, so the
 * list decides it there. `"keep-all"` removes nothing, for the reads a route
 * makes before it knows the entry: a block that may show still asks for what
 * it binds.
 *
 * Returns the ORIGINAL document when nothing was removed, as every pruning
 * pass does.
 *
 * @experimental
 */
export function gateByConditions(
  document: BlockDocument,
  gate: ConditionGate | "keep-all"
): GatedDocument {
  if (gate === "keep-all") {
    return { document, held: new Set(), issues: [] };
  }
  const held = new Set<string>();
  const issues: ConditionIssue[] = [];
  const gated = pruneNodesIn(
    document,
    PAGE_SCOPE,
    (node, scope) => {
      const verdict = entryVerdictOf(node, scope, gate, issues);
      if (verdict === "shown") held.add(node.id);
      return verdict !== "hidden";
    },
    conditionScopeIn
  );
  return { document: gated, held, issues };
}

/** Where a page's own blocks read: the entry it is drawn for. */
const PAGE_SCOPE: ConditionScope = { source: "entry", collection: undefined };

/**
 * One block's verdict under the page's gate, in the scope its conditions
 * read: `free` with no conditions restricting anyone, `item` where a list's
 * item decides it, else `shown` or `hidden` as its conditions hold for the
 * page's entry, what could not be checked added to `issues`. The one
 * judgement both the route's gate and the editor's marking pass make.
 */
function entryVerdictOf(
  node: BlockNode,
  scope: ConditionScope,
  gate: ConditionGate,
  issues: ConditionIssue[]
): "free" | "item" | "shown" | "hidden" {
  if (!isConditionGated(node)) return "free";
  if (scope.source === "item") return "item";
  const evaluation = evaluateConditions(node, {
    source: "entry",
    ...(gate.entry === undefined ? {} : { subject: gate.entry }),
    ...(gate.dayStart === undefined ? {} : { dayStart: gate.dayStart }),
  });
  issues.push(...evaluation.issues);
  return evaluation.shown ? "shown" : "hidden";
}

/**
 * How an editor judges a page's conditions while it shows the page as a
 * visitor reading an entry gets it: the route's gate for that entry, what to
 * draw in place of a block it hides, and where to say what it judged.
 *
 * @experimental
 */
export interface EntryJudgement extends ConditionGate {
  /** The node drawn in a hidden block's place; nothing drops the block. */
  readonly hiddenAs: (node: BlockNode) => BlockNode | undefined;
  /** Told each block judged, by id, and whether it shows. */
  readonly onJudged?: (nodeId: string, shown: boolean) => void;
}

/**
 * The page as an editor draws it with its conditions judged for an entry,
 * each block judged exactly as {@link gateByConditions} judges it: one whose
 * conditions hold is drawn with them lifted, one they hide is replaced by
 * what `judgement.hiddenAs` gives, and one a list's item decides is left for
 * the list. Never for a published page, which the route gates itself.
 *
 * @experimental
 */
export function markByConditions(
  document: BlockDocument,
  judgement: EntryJudgement
): GatedDocument {
  const issues: ConditionIssue[] = [];
  const marked = rewriteNodesIn(
    document,
    PAGE_SCOPE,
    (node, scope): Rewrite => {
      const verdict = entryVerdictOf(node, scope, judgement, issues);
      if (verdict === "free" || verdict === "item") {
        return { node, descend: true };
      }
      judgement.onJudged?.(node.id, verdict === "shown");
      if (verdict === "shown") return { node: liftedNode(node), descend: true };
      const instead = judgement.hiddenAs(node);
      return instead === undefined ? null : { node: instead, descend: false };
    },
    conditionScopeIn
  );
  return { document: marked, held: new Set(), issues };
}

/**
 * One block with its own conditions lifted, as an editor draws a block they
 * hold for, keeping its devices and everything else it carries; its slots
 * as given, for a walk to go on into.
 *
 * @experimental
 */
export function liftedNode(node: BlockNode): BlockNode {
  const { slots, ...self } = node;
  const lifted =
    revealConditioned({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [self],
    }).nodes[0] ?? self;
  return slots === undefined ? lifted : { ...lifted, slots };
}

/**
 * Whether a block has declared that this node's props make it draw nothing.
 *
 * The declaration is computed from stored props, so it is knowable before any
 * block runs — which is what lets the stylesheet decision use it. It is asked
 * through the engine's own rule rather than restated, for the reason
 * {@link isUnconditional} gives: the style compiler asks the same question about
 * the same node, and two implementations of it are two answers that can drift.
 */
export function drawsNothing(
  node: BlockNode,
  resolver: BlockResolver
): boolean {
  return declaresNoMarkup(node, type => resolver.get(type));
}

/**
 * Whether a block is served where it is being drawn, by its visibility
 * conditions.
 *
 * A block without conditions, or whose conditions restrict nobody, is. One
 * the route kept because its conditions held for the page's entry is
 * (`decided.held`). Any other conditioned block that reaches a render is
 * one a list's item decides, since the route removed every entry-scoped one
 * that did not hold: inside a list it is decided now, against the item being
 * drawn and its collection's public fields (or, for a named query's row, the
 * fields its rows declare), and reported through
 * `decided.report` when it cannot be checked. Outside a list nothing can decide it, so it
 * stays out.
 *
 * @experimental
 */
export function conditionAllows(
  node: BlockNode,
  context: ItemContext & Pick<PageContext, "timeZone">,
  decided: {
    /** The blocks the route kept because their conditions held, by id. */
    readonly held?: ReadonlySet<string>;
    readonly report?: (issues: readonly ConditionIssue[]) => void;
  } = {}
): boolean {
  if (!isConditionGated(node)) return true;
  if (decided.held?.has(node.id) === true) return true;
  if (context.item === undefined) return false;
  const evaluation = evaluateConditions(node, {
    source: "item",
    ...itemSubject(context),
    dayStart: conditionDayStart(context.timeZone),
  });
  if (evaluation.issues.length > 0) decided.report?.(evaluation.issues);
  return evaluation.shown;
}

/** What a condition reads of the item being drawn, and where it came from. */
type ItemContext = Pick<
  PageContext,
  "item" | "itemSource" | "itemQuery" | "fieldShapes" | "namedQueries"
>;

/**
 * The fields of the item being drawn, as the public sees them: its
 * collection's, or, for a named query's row with a schema of its own, the
 * fields its query declares, as the row's bindings are checked against.
 */
export function itemFields(
  context: ItemContext
): readonly BindingFieldShape[] | undefined {
  const source = context.itemSource;
  if (source !== undefined && source !== "") {
    return context.fieldShapes?.fieldsOf({ collection: source });
  }
  return typeof context.itemQuery === "string"
    ? queryRowFields(context.namedQueries, context.itemQuery, collection =>
        context.fieldShapes?.fieldsOf({ collection })
      )
    : undefined;
}

/**
 * The item being drawn as a condition reads it: its values, and its fields
 * as the public sees them. Nothing when its fields are not known, so its
 * conditions fail closed.
 */
function itemSubject(context: ItemContext): { subject?: ConditionSubject } {
  const readable = context.item === undefined ? undefined : itemFields(context);
  if (readable === undefined || context.item === undefined) return {};
  return {
    subject: {
      // The public's fields are all a page is handed, so a field outside them
      // reads as one the collection lacks; either way it fails closed.
      fields: {
        declared: new Set(readable.map(field => field.name)),
        readable,
      },
      values: context.item,
    },
  };
}

/**
 * The blocks of a gated document whose conditions read the page's entry, by
 * id: after {@link gateByConditions} has removed every one that did not hold,
 * exactly the ones that did. Read off the tree that is drawn, so a block a
 * later pass removed, such as a duplicate address, names nothing.
 *
 * @experimental
 */
export function entryConditionedIn(document: BlockDocument): Set<string> {
  const held = new Set<string>();
  const visit = (nodes: readonly BlockNode[], scope: ConditionScope): void => {
    for (const node of nodes) {
      if (scope.source === "entry" && isConditionGated(node)) held.add(node.id);
      for (const [slot, children] of Object.entries(node.slots ?? {})) {
        visit(children, conditionScopeIn(node, slot, scope));
      }
    }
  };
  visit(document.nodes, { source: "entry", collection: undefined });
  return held;
}

/** The page's entry as a condition reads it, when the public may read it. */
export function entrySubjectOf(bindings: PageBindings | undefined): {
  entry?: ConditionSubject;
} {
  const values = bindings?.entry;
  const ref = bindings?.entryRef;
  // Whether the page has an entry to judge is the route's to decide, before
  // it reads: a Single's page never reaches here (see `readPageInputs`).
  if (ref === undefined) return {};
  const readable = bindings?.fieldShapes?.fieldsOf(ref);
  if (values === undefined || values === null || readable === undefined) {
    return {};
  }
  return {
    entry: {
      // The public's fields are all a page is handed, so a field outside them
      // reads as one the entry lacks; either way it fails closed.
      fields: {
        declared: new Set(readable.map(field => field.name)),
        readable,
      },
      values,
    },
  };
}
