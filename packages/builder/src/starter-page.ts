/**
 * Starting an empty page from a starter page's blocks, inside the builder:
 * the start area's "or start from a page" row.
 *
 * Through the existing ops, as every edit is: the engine's paste planner
 * makes a fresh-id copy of the starter's blocks (the copy a paste makes, with
 * no record of a saved section it did not come from), and the editor's
 * `applyAll` commits the whole copy as ONE step, so a single Undo empties the
 * page again. Nothing links the page back to the starter: a later change to
 * the starter never reaches it.
 *
 * Only an empty page is started this way. The row is drawn on an empty page
 * alone, and a page that gained a block meanwhile is left as it is rather
 * than having the starter's blocks put beside its own.
 *
 * @module starter-page
 */
import {
  planPasteBlocks,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type ComponentLookup,
  type NestingSource,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";

/** What the copy is judged by: the site's nesting rules, and its components. */
export interface StarterPageSources {
  readonly nesting?: NestingSource;
  readonly components?: ComponentLookup;
}

/**
 * The ops that start `document` from `blocks`, or `undefined` where the page
 * is not empty or the planner refuses the copy.
 *
 * @experimental
 */
export function planStarterPage(
  document: BlockDocument,
  blocks: readonly BlockNode[],
  sources: StarterPageSources = {}
): readonly BuilderOp[] | undefined {
  if (document.nodes.length > 0) return undefined;
  const plan = planPasteBlocks(
    document,
    blocks,
    { index: 0 },
    sources.nesting ?? registryNestingSource(),
    sources.components
  );
  return plan.pageOps;
}

/**
 * Start the editor's empty page from `blocks`, as one undo step. Returns
 * whether it was started; nothing changes when it was not.
 *
 * @experimental
 */
export function applyStarterPage(
  editor: Pick<EditorState, "document" | "applyAll">,
  blocks: readonly BlockNode[],
  sources: StarterPageSources = {}
): boolean {
  const ops = planStarterPage(editor.document, blocks, sources);
  if (ops === undefined || ops.length === 0) return false;
  return editor.applyAll(ops) !== null;
}
