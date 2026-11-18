/**
 * "+ Add a question": which accordion it is drawn for, and what it adds.
 * Its look and its press on a real canvas are the browser test's
 * (`e2e/tests/builder-accordion-questions.spec.ts`).
 *
 * @module canvas/accordion-add-question.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accordionForSelection,
  addQuestionOp,
  questionButtonBox,
  questionRoomRow,
} from "./accordion-add-question";

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => clearBlocks());

const document = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "acc",
      type: "core/accordion",
      version: 1,
      props: { openMode: "one" },
      slots: {
        children: ["Question 1", "Question 2", "Question 3"].map(
          (title, index) => ({
            id: `q${index}`,
            type: "core/accordion-item",
            version: 1,
            props: { title },
            slots: {
              children: [
                { id: `t${index}`, type: "core/text", version: 2, props: {} },
              ],
            },
          })
        ),
      },
    },
    { id: "h", type: "core/heading", version: 1, props: {} },
  ],
} as unknown as BlockDocument;

describe("the accordion '+ Add a question' is drawn for", () => {
  it("is the selected accordion, or the one holding the selected question", () => {
    expect(accordionForSelection(document, ["acc"])?.id).toBe("acc");
    expect(accordionForSelection(document, ["q1"])?.id).toBe("acc");
  });

  it("is none for another block, a block inside an answer, or several", () => {
    expect(accordionForSelection(document, ["h"])).toBeUndefined();
    expect(accordionForSelection(document, ["t0"])).toBeUndefined();
    expect(accordionForSelection(document, ["acc", "h"])).toBeUndefined();
    expect(accordionForSelection(document, [])).toBeUndefined();
  });
});

describe("what '+ Add a question' adds", () => {
  // Made in each test, once the core blocks are registered.
  const added = () => addQuestionOp(document, document.nodes[0] as BlockNode);

  it("is the next numbered question, at the end of the accordion", () => {
    const op = added();
    expect(op?.at).toEqual({ parentId: "acc", slot: "children", index: 3 });
    expect(op?.node.type).toBe("core/accordion-item");
    expect(op?.node.props.title).toBe("Question 4");
  });

  it("holds an answer to write over, as a question added from the Add panel does", () => {
    const op = added();
    const answer = op?.node.slots?.children ?? [];
    expect(answer.map(each => each.type)).toEqual(["core/text"]);
    expect(JSON.stringify(answer[0]?.props)).toContain(
      "Write the answer here."
    );
  });
});

describe("where '+ Add a question' sits", () => {
  // An accordion 300px tall at y 100, so its 44px room runs from 356 to 400.
  const full = { x: 20, y: 100, width: 400, height: 300 };

  it("is the room after the last question, when the whole accordion shows", () => {
    expect(questionRoomRow(full, full, 1)).toEqual({
      x: 20,
      y: 356,
      width: 400,
      height: 44,
    });
  });

  it("is the room still, when a scrolling container cuts only the accordion's top", () => {
    const visible = { x: 20, y: 250, width: 400, height: 150 };
    expect(questionRoomRow(full, visible, 1)?.y).toBe(356);
  });

  it("is nowhere while a container cuts the room off, never over a question", () => {
    // The container shows 100 to 300: the room is scrolled out below. The
    // bottom of what shows, 256 to 300, is a question, which a button
    // placed there would cover.
    const above = { x: 20, y: 100, width: 400, height: 200 };
    expect(questionRoomRow(full, above, 1)).toBeNull();
    // Half the room shows.
    const half = { x: 20, y: 100, width: 400, height: 278 };
    expect(questionRoomRow(full, half, 1)).toBeNull();
    // Cut on the left, where the button starts.
    const left = { x: 60, y: 100, width: 360, height: 300 };
    expect(questionRoomRow(full, left, 1)).toBeNull();
  });

  it("is the room at the canvas's zoom, which the page draws 44px over the zoom tall", () => {
    // At half zoom the room is 88 of the page's pixels.
    expect(questionRoomRow(full, full, 0.5)).toEqual({
      x: 20,
      y: 312,
      width: 400,
      height: 88,
    });
  });
});

describe("how wide '+ Add a question' may be", () => {
  it("is never wider than the accordion's room, so it never covers a block beside it", () => {
    // A narrow column, 120px wide, at x 40.
    expect(
      questionButtonBox({ x: 40, y: 300, width: 120, height: 44 })
    ).toEqual({ left: 40, top: 300, maxWidth: 120 });
  });
});
