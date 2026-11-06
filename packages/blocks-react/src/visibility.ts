import {
  conditionScopeIn,
  declaresNoMarkup,
  evaluateConditions,
  isConditionGated,
  type BlockDocument,
  type BlockNode,
  type ConditionDayStart,
  type ConditionIssue,
  type ConditionScope,
  type ConditionSubject,
} from "@nextlyhq/blocks-engine";

import { conditionDayStart } from "./blocks/list-read";
import type { PageContext } from "./context";
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
  let changed = false;

  const prune = (nodes: BlockNode[], scope: Scope): BlockNode[] => {
    const kept: BlockNode[] = [];
    for (const node of nodes) {
      if (!keep(node, scope)) {
        changed = true;
        continue;
      }

      const slots = node.slots;
      if (slots === undefined) {
        kept.push(node);
        continue;
      }

      let slotsChanged = false;
      const nextSlots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(slots)) {
        const prunedChildren = prune(children, within(node, name, scope));
        if (prunedChildren !== children) slotsChanged = true;
        nextSlots[name] = prunedChildren;
      }
      kept.push(slotsChanged ? { ...node, slots: nextSlots } : node);
    }
    return changed ? kept : nodes;
  };

  const nodes = prune(document.nodes, root);
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
  const page: ConditionScope = { source: "entry", collection: undefined };
  const gated = pruneNodesIn(
    document,
    page,
    (node, scope) => {
      if (!isConditionGated(node) || scope.source === "item") return true;
      const evaluation = evaluateConditions(node, {
        source: "entry",
        ...(gate.entry === undefined ? {} : { subject: gate.entry }),
        ...(gate.dayStart === undefined ? {} : { dayStart: gate.dayStart }),
      });
      issues.push(...evaluation.issues);
      if (evaluation.shown) held.add(node.id);
      return evaluation.shown;
    },
    (node, slot, scope) => conditionScopeIn(node, slot, scope)
  );
  return { document: gated, held, issues };
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
 * drawn and its collection's public fields, and reported through
 * `decided.report` when it cannot be checked. Outside a list nothing can decide it, so it
 * stays out.
 *
 * @experimental
 */
export function conditionAllows(
  node: BlockNode,
  context: Pick<
    PageContext,
    "item" | "itemSource" | "fieldShapes" | "timeZone"
  >,
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

/**
 * The item being drawn as a condition reads it: its values, and its
 * collection's fields as the public sees them. Nothing when the collection
 * or its fields are not known, so its conditions fail closed.
 */
function itemSubject(
  context: Pick<PageContext, "item" | "itemSource" | "fieldShapes">
): { subject?: ConditionSubject } {
  const source = context.itemSource;
  const readable =
    context.item === undefined || source === undefined || source === ""
      ? undefined
      : context.fieldShapes?.fieldsOf({ collection: source });
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
