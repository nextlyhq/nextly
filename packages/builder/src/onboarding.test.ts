/**
 * The checklist, derived from the page rather than tracked as the author works.
 *
 * Driven through the real registry: whether a value counts as text an author
 * could have written is the block's own declaration, and a stub restating it
 * would agree today and drift afterwards.
 *
 * @module onboarding.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  builderChecklist,
  checklistComplete,
  checklistDoneCount,
} from "./onboarding";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(clearBlocks);

/**
 * Registered once per test, not once per call.
 *
 * `registerBlocks` refuses a redefinition, and several cases below build two
 * documents to compare — so a helper that registered unconditionally would
 * throw in exactly the tests that assert a step changing.
 */
function register() {
  if (hasBlock("acme/heading")) return;
  registerBlocks(
    [
      {
        ...base,
        name: "acme/heading",
        props: {
          text: { type: "text", inline: true },
          level: { type: "text" },
        },
      },
      // A block with NOTHING an author can type into, so "write something"
      // cannot be satisfied by adding one.
      { ...base, name: "acme/divider", props: {} },
      // A block placed with text of its own, which nobody here wrote.
      {
        ...base,
        name: "acme/titled",
        props: { text: { type: "text", inline: true } },
        defaultProps: { text: "Heading" },
      },
      // Placed with its EXAMPLE's text over an empty default, as core/heading
      // is: the inserter's starting props, not the default alone.
      {
        ...base,
        name: "acme/exampled",
        props: { text: { type: "text", inline: true } },
        defaultProps: { text: "" },
        example: { props: { text: "A section title" } },
        // A variation placed with text of its own, as a plugin's may be.
        editor: {
          variations: [{ name: "hero", props: { text: "Hero title" } }],
        },
      },
    ] as never,
    { source: "onboarding-test" }
  );
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  register();
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function heading(id: string, text?: string): BlockNode {
  return {
    id,
    type: "acme/heading",
    version: 1,
    props: text === undefined ? {} : { text },
  } as BlockNode;
}

function step(document: BlockDocument, id: string) {
  return builderChecklist(document).find(s => s.id === id);
}

describe("builderChecklist", () => {
  it("asks for a first block on an empty page", () => {
    const empty = documentOf([]);

    expect(step(empty, "add-block")?.done).toBe(false);
    expect(step(empty, "write-text")?.done).toBe(false);
    expect(step(empty, "build-page")?.done).toBe(false);
  });

  it("points at the empty page's own Add section button first", () => {
    // The start card's button is on the canvas beside this step, so the step
    // names it before the rail.
    expect(step(documentOf([]), "add-block")?.hint).toBe(
      "Click Add section, or open Add in the left rail."
    );
  });

  it("names the control an empty component offers, which adds blocks", () => {
    // A component has no sections: its start card's button says Add block.
    const component = { ...documentOf([]), kind: "component" } as never;
    expect(step(component, "add-block")?.hint).toBe(
      "Click Add block, or open Add in the left rail."
    );
  });

  it.each(["pattern", "region", "template"])(
    "names Add block for an empty %s, which has no sections",
    kind => {
      const document = { ...documentOf([]), kind } as never;
      expect(step(document, "add-block")?.hint).toBe(
        "Click Add block, or open Add in the left rail."
      );
    }
  );

  it("names Add block for a document of a kind it does not know", () => {
    const document = { ...documentOf([]), kind: "a-future-kind" } as never;
    expect(step(document, "add-block")?.hint).toBe(
      "Click Add block, or open Add in the left rail."
    );
  });

  it("counts the first block as done once one is there", () => {
    expect(step(documentOf([heading("a")]), "add-block")?.done).toBe(true);
  });

  it("does NOT count writing as done for a block with empty text", () => {
    // The step an inserted-but-untouched block would otherwise complete for
    // free, telling an author they had learned a gesture they never used.
    expect(step(documentOf([heading("a", "")]), "write-text")?.done).toBe(
      false
    );
  });

  it("does not count whitespace as writing", () => {
    expect(step(documentOf([heading("a", "   ")]), "write-text")?.done).toBe(
      false
    );
  });

  it("counts writing as done once a block carries text", () => {
    expect(step(documentOf([heading("a", "Hello")]), "write-text")?.done).toBe(
      true
    );
  });

  it("does not count a block's starting text as writing", () => {
    // Placing a heading that reads "Heading" is adding a block, not writing.
    const titled = (text: string) =>
      ({
        id: "t",
        type: "acme/titled",
        version: 1,
        props: { text },
      }) as BlockNode;
    expect(step(documentOf([titled("Heading")]), "write-text")?.done).toBe(
      false
    );
    expect(step(documentOf([titled("  Heading ")]), "write-text")?.done).toBe(
      false
    );
    expect(step(documentOf([titled("Our story")]), "write-text")?.done).toBe(
      true
    );
  });

  it("does not count the text a block is placed with from its example", () => {
    const exampled = (text: string) =>
      ({
        id: "e",
        type: "acme/exampled",
        version: 1,
        props: { text },
      }) as BlockNode;
    expect(
      step(documentOf([exampled("A section title")]), "write-text")?.done
    ).toBe(false);
    expect(step(documentOf([exampled("About us")]), "write-text")?.done).toBe(
      true
    );
  });

  it("does not count the text a block is placed with as one of its variations", () => {
    const placed = {
      id: "v",
      type: "acme/exampled",
      version: 1,
      props: { text: "Hero title" },
    } as BlockNode;
    expect(step(documentOf([placed]), "write-text")?.done).toBe(false);
  });

  it("finds text on a NESTED block", () => {
    // The page is a tree. A walk that read only the top level would ask an
    // author to write something they had already written inside a container.
    const nested = documentOf([
      {
        id: "outer",
        type: "acme/divider",
        version: 1,
        props: {},
        slots: { content: [heading("inner", "Nested words")] },
      } as BlockNode,
    ]);

    expect(step(nested, "write-text")?.done).toBe(true);
  });

  it("cannot be satisfied by a block with nothing to type into", () => {
    const dividers = documentOf([
      { id: "a", type: "acme/divider", version: 1, props: {} } as BlockNode,
    ]);

    expect(step(dividers, "add-block")?.done).toBe(true);
    expect(step(dividers, "write-text")?.done).toBe(false);
  });

  it("asks for a second block until there are two", () => {
    expect(step(documentOf([heading("a", "Hi")]), "build-page")?.done).toBe(
      false
    );
    expect(
      step(documentOf([heading("a", "Hi"), heading("b")]), "build-page")?.done
    ).toBe(true);
  });

  it("goes BACK to incomplete when the work is undone", () => {
    // Derivation's honest cost, asserted rather than left to be discovered.
    // The checklist describes the page, not a person's history with it.
    expect(step(documentOf([heading("a", "Hi")]), "write-text")?.done).toBe(
      true
    );
    expect(step(documentOf([heading("a", "")]), "write-text")?.done).toBe(
      false
    );
  });
});

describe("checklistComplete", () => {
  it("is true only when every step is done", () => {
    const full = documentOf([heading("a", "Hi"), heading("b")]);

    expect(checklistComplete(builderChecklist(full))).toBe(true);
    expect(checklistDoneCount(builderChecklist(full))).toBe(3);
  });

  it("is false while any step is outstanding", () => {
    const partial = documentOf([heading("a", "Hi")]);

    expect(checklistComplete(builderChecklist(partial))).toBe(false);
    expect(checklistDoneCount(builderChecklist(partial))).toBe(2);
  });

  it("is false for an empty list rather than vacuously true", () => {
    // `every` on nothing is true, which would report a checklist that failed to
    // build as finished — and the card would never appear.
    expect(checklistComplete([])).toBe(false);
  });
});
