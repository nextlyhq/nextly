/**
 * How condition-gated rules are served: appended for the gated nodes that
 * survived, and the rules of each block a list's item decides, held out of
 * the page's sheet for the list to serve.
 *
 * @module styles-gated-rules
 */
import {
  conditionScopeIn,
  isConditionGated,
  type BlockDocument,
  type BlockNode,
  type ConditionScope,
} from "@nextlyhq/blocks-engine";

import type { PageStyles } from "./styles-artifact";
import {
  documentNodeIds,
  isUsableGatedEntry,
  readableGatedRules,
} from "./styles-stored-trust";
import { pruneNodes } from "./visibility";

/**
 * A stored sheet with the gated rules of the nodes that SURVIVED appended.
 *
 * The stored `css` is always incomplete when `gated` is present, so this is
 * delivery rather than repair: the survivors are appended whether or not
 * anything about the document was repaired. Making it conditional on repair
 * would work only for as long as every conditioned node is pruned — the moment
 * one survives, nothing is repaired, the incomplete sheet ships unchanged and
 * that node renders unstyled.
 *
 * The set is taken from the document being RENDERED, never from re-reading
 * `visibility.conditions`. Walking the surviving nodes means the rules appended
 * are definitionally the rules of the nodes that rendered; a second derivation
 * of the pruning rule is exactly how a sheet and its markup come apart.
 *
 * Appending AFTER the main sheet is safe. Each node's local rules are written
 * against its own hashed class, so two nodes' entries can never target the same
 * element; only tier order matters, and each entry preserves its own tiers
 * internally.
 */
export function withGatedRules(
  styles: PageStyles,
  document: BlockDocument,
  drawsNothing: (node: BlockNode) => boolean
): PageStyles {
  const entries = readableGatedRules(styles);
  if (entries === undefined || styles.css === undefined) return styles;
  const appended: string[] = [];
  // Which nodes have EARNED their rules back. Surviving the visibility prune is
  // one half; the other is that the block did not answer that these props draw
  // nothing, because appending such a node's rules would put back exactly what
  // holding them per node was for.
  //
  // Asked HERE rather than left to the caller because this function is exported
  // and the documented direct flow — `prepareDocumentForRead` then this — has no
  // pass that removes such a node. A consumer following it would otherwise
  // publish the rules while the block drew nothing, with no way to prevent it.
  //
  // Through the PRUNE rather than a per-node test, because the answer is not
  // per-node: a block that draws nothing places none of its slot children, so
  // the compiler holds the whole subtree back and those descendants each answer
  // "I draw" about themselves. Testing each node alone would skip the container
  // and append every child under it. One walk, one rule, no way for the two to
  // disagree about a subtree.
  //
  // The failure direction is the safe one: the test answers "draws" for anything
  // short of an explicit `true`, so a block that cannot be asked keeps its
  // styling.
  const surviving = pruneNodes(document, node => !drawsNothing(node));
  // A block a list's item decides is served only where an item shows it,
  // which only the list knows as it draws: its rules go out with the first
  // instance drawn ({@link itemDecidedRules}), never here.
  const itemDecided = itemDecidedIds(surviving);
  for (const id of documentNodeIds(surviving)) {
    if (itemDecided.has(id)) continue;
    const rules = entries[id];
    if (isUsableGatedEntry(rules)) appended.push(rules);
  }
  if (appended.length === 0) return styles;
  // An empty main sheet is joined without a leading newline. `css` is legitimately
  // empty whenever every styled node was gated — a page whose only styling lives
  // on a conditioned block compiles to exactly that — so emptiness cannot be read
  // as a refusal here. The refusal is decided by `normalizeStoredStyles`, which
  // rebuilds the classes; this only ever sees what that returned.
  const parts = styles.css === "" ? appended : [styles.css, ...appended];
  return { ...styles, css: parts.join("\n") };
}

/**
 * The ids of every block a list's item decides the visibility of, and of
 * every block inside one: the conditioned blocks in a list's per-entry slot,
 * whose rules a reader may serve only once an item shows them.
 */
function itemDecidedIds(document: BlockDocument): Set<string> {
  const decided = new Set<string>();
  const page: ConditionScope = { source: "entry", collection: undefined };
  const visit = (
    nodes: readonly BlockNode[],
    scope: ConditionScope,
    inside: boolean
  ): void => {
    for (const node of nodes) {
      const mine =
        inside || (scope.source === "item" && isConditionGated(node));
      if (mine) decided.add(node.id);
      for (const [slot, children] of Object.entries(node.slots ?? {})) {
        visit(children, conditionScopeIn(node, slot, scope), mine);
      }
    }
  };
  visit(document.nodes, page, false);
  return decided;
}

/**
 * The rules of each block a list's item decides, with those of every block
 * inside it, by the decided block's id: what a list serves beside the first
 * instance it draws of one, so the rules of a block no item shows are never
 * served at all.
 *
 * @internal Shared by this package's renderer.
 */
export function itemDecidedRules(
  styles: PageStyles,
  document: BlockDocument,
  drawsNothing: (node: BlockNode) => boolean
): ReadonlyMap<string, string> {
  const entries = readableGatedRules(styles);
  const found = new Map<string, string>();
  if (entries === undefined) return found;
  // A block's own rules and those of every block inside it that it draws
  // whenever it is drawn: not a nested conditioned block, whose rules go out
  // when its own conditions hold, nor a block that draws nothing.
  const gather = (node: BlockNode, into: string[], root: boolean): void => {
    if (drawsNothing(node)) return;
    if (!root && isConditionGated(node)) return;
    const rules = entries[node.id];
    if (isUsableGatedEntry(rules)) into.push(rules);
    for (const children of Object.values(node.slots ?? {})) {
      for (const child of children) gather(child, into, false);
    }
  };
  const page: ConditionScope = { source: "entry", collection: undefined };
  const visit = (nodes: readonly BlockNode[], scope: ConditionScope): void => {
    for (const node of nodes) {
      if (scope.source === "item" && isConditionGated(node)) {
        const rules: string[] = [];
        gather(node, rules, true);
        if (rules.length > 0) found.set(node.id, rules.join("\n"));
      }
      // On inside, so a conditioned block nested in this one has its own.
      for (const [slot, children] of Object.entries(node.slots ?? {})) {
        visit(children, conditionScopeIn(node, slot, scope));
      }
    }
  };
  visit(document.nodes, page);
  return found;
}
