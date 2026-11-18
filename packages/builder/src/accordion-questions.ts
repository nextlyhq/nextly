/**
 * A question added to an Accordion takes the next number: "Question 4" after
 * three. One rule, asked by every way the editor adds a block (the Add panel's
 * click and drag, and the canvas's "+ Add a question"), so a question never
 * arrives titled with another's number or with the block's bare default.
 *
 * The next number is one past the highest of the accordion's question count
 * and any number its titles already carry, so a question deleted from the
 * middle, or one an author numbered by hand, is never repeated.
 *
 * @module accordion-questions
 */
import {
  findNode,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { OpPosition } from "./op-vocabulary";

/** A Question's registered name. */
export const QUESTION_BLOCK = "core/accordion-item";

/**
 * The attribute the canvas marks the accordion "+ Add a question" is drawn
 * for with, on the canvas's element only: the frame's sheet gives it a row
 * of room after its last question, where the button sits.
 */
export const QUESTION_ROOM_ATTRIBUTE = "data-nx-question-room";

/**
 * The room's height on that accordion, in the page's pixels: the button's
 * height at the canvas's zoom, written by the canvas beside the attribute.
 */
export const QUESTION_ROOM_PROPERTY = "--nx-question-room";

/** The Accordion's registered name. */
const ACCORDION_BLOCK = "core/accordion";

/** The slot an Accordion holds its questions in. */
const QUESTIONS_SLOT = "children";

/** A title the editor numbered: "Question" and a whole number. */
const NUMBERED = /^\s*Question\s+(\d{1,9})\s*$/;

/** The title the next question added to this accordion takes. */
export function nextQuestionTitle(accordion: BlockNode): string {
  const questions = accordion.slots?.[QUESTIONS_SLOT] ?? [];
  let highest = questions.length;
  for (const question of questions) {
    const title = question?.props?.title;
    const match = typeof title === "string" ? NUMBERED.exec(title) : null;
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
  }
  return `Question ${String(highest + 1)}`;
}

/**
 * A newly made block, numbered for where it lands: a Question going into an
 * Accordion's questions takes the next number there. Any other block, or a
 * Question landing anywhere else, is returned as it was.
 */
export function numberedForPlace(
  node: BlockNode,
  at: OpPosition,
  document: BlockDocument
): BlockNode {
  if (node.type !== QUESTION_BLOCK || at.parentId === undefined) return node;
  if (at.slot !== QUESTIONS_SLOT) return node;
  const accordion = findNode(document.nodes, at.parentId);
  if (accordion?.type !== ACCORDION_BLOCK) return node;
  return {
    ...node,
    props: { ...node.props, title: nextQuestionTitle(accordion) },
  };
}
