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
