/**
 * What a first-time author has not done yet, derived from the page itself.
 *
 * Every step is DERIVED from the document rather than tracked as the author
 * works. Tracking would need a second store of "has this person inserted a
 * block", which drifts from the page the moment anything else changes it —
 * an import, a duplicate of an existing page, a colleague's edit — and then
 * congratulates someone for work they did not do, or asks them to do what is
 * already there.
 *
 * Derivation has one honest cost: a step completed and then undone goes back to
 * incomplete. That is the right reading. The checklist describes the PAGE, not
 * a person's history with it, and a page with no blocks is a page whose author
 * still needs to add one.
 *
 * ## Why these three
 *
 * They are the gestures nothing else in the editor teaches, in the order an
 * author meets them, and each is separately observable in the document. A step
 * that completed as a side effect of another would tell an author they had
 * learned something they never did.
 *
 * @module onboarding
 */

import { walkNodes, type BlockDocument } from "@nextlyhq/blocks-engine";

import { inlineTargets } from "./inline-text";

/** One thing to do, and whether the page shows it has been done. */
export interface ChecklistStep {
  readonly id: string;
  /** What to do, in the imperative. */
  readonly label: string;
  /** How to do it, naming the gesture. */
  readonly hint: string;
  readonly done: boolean;
}

/** Whether any block on the page carries text an author typed. */
function hasAuthoredText(document: BlockDocument): boolean {
  let found = false;
  walkNodes(document.nodes, node => {
    if (found) return;
    // Asked of the same rule the canvas uses to decide what may be typed into,
    // so "text an author could have written here" means one thing in both
    // places. A block with no inline values cannot satisfy this step, which is
    // correct: there was nothing to type.
    found = inlineTargets(document, node.id).some(
      target => target.value.trim() !== ""
    );
  });
  return found;
}

/** How many top-level blocks the page holds. */
function topLevelCount(document: BlockDocument): number {
  return document.nodes.length;
}

/**
 * The checklist for this page.
 *
 * @param document - the page being edited
 * @returns the steps, in the order an author meets them
 */
export function builderChecklist(
  document: BlockDocument
): readonly ChecklistStep[] {
  const blocks = topLevelCount(document);
  return [
    {
      id: "add-block",
      label: "Add your first block",
      // The one gesture nothing else on screen suggests: an empty canvas looks
      // like a page with nothing wrong with it.
      hint: "Open Insert in the left rail and choose one.",
      done: blocks > 0,
    },
    {
      id: "write-text",
      label: "Write something",
      hint: "Double-click text on the canvas, or select a block and press Enter.",
      done: hasAuthoredText(document),
    },
    {
      id: "build-page",
      label: "Add a second block",
      hint: "A page is a stack of blocks. Drag one above another to reorder.",
      done: blocks > 1,
    },
  ];
}

/**
 * Whether every step is done.
 *
 * Derived here rather than counted by each caller, so the card and anything
 * that decides whether to render it cannot disagree about what finished means.
 */
export function checklistComplete(steps: readonly ChecklistStep[]): boolean {
  return steps.length > 0 && steps.every(step => step.done);
}

/** How many are done, for a progress reading. */
export function checklistDoneCount(steps: readonly ChecklistStep[]): number {
  return steps.filter(step => step.done).length;
}
