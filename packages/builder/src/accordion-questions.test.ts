/**
 * A question added to an Accordion takes the next number.
 *
 * @module accordion-questions.test
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  nextQuestionTitle,
  numberedForPlace,
  QUESTION_BLOCK,
} from "./accordion-questions";

/** An accordion holding questions with these titles. */
function accordion(...titles: unknown[]): BlockNode {
  return {
    id: "acc",
    type: "core/accordion",
    version: 1,
    props: {},
    slots: {
      children: titles.map((title, index) => ({
        id: `q${index}`,
        type: QUESTION_BLOCK,
        version: 1,
        props: { title },
      })),
    },
  } as BlockNode;
}

/** A question as the Add panel makes one, with the block's default title. */
const added: BlockNode = {
  id: "new",
  type: QUESTION_BLOCK,
  version: 1,
  props: { title: "Question", open: false },
};

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

describe("the next question's title", () => {
  it("is Question 4 after the three a new accordion starts with", () => {
    expect(
      nextQuestionTitle(accordion("Question 1", "Question 2", "Question 3"))
    ).toBe("Question 4");
  });

  it("counts questions an author retitled", () => {
    expect(
      nextQuestionTitle(accordion("Shipping?", "Returns?", "Question 3"))
    ).toBe("Question 4");
    expect(nextQuestionTitle(accordion("Shipping?", "Returns?"))).toBe(
      "Question 3"
    );
  });

  it("never repeats a number still in use after one was deleted", () => {
    // Question 2 deleted: two left, but Question 3 is taken.
    expect(nextQuestionTitle(accordion("Question 1", "Question 3"))).toBe(
      "Question 4"
    );
  });

  it("starts an empty accordion at Question 1", () => {
    expect(nextQuestionTitle(accordion())).toBe("Question 1");
  });
});

describe("a question placed by an insert", () => {
  it("takes the next number in the accordion it lands in", () => {
    const document = page(accordion("Question 1", "Question 2", "Question 3"));
    const at = { parentId: "acc", slot: "children", index: 3 };
    expect(numberedForPlace(added, at, document).props.title).toBe(
      "Question 4"
    );
  });

  it("leaves any other block, or a question placed elsewhere, as it was", () => {
    const document = page(accordion("Question 1"));
    const heading = { ...added, type: "core/heading" };
    const at = { parentId: "acc", slot: "children", index: 1 };
    expect(numberedForPlace(heading, at, document)).toBe(heading);
    expect(numberedForPlace(added, { index: 0 }, document)).toBe(added);
  });
});
