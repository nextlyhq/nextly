// @vitest-environment jsdom

/**
 * The browser's own drag of a picture or a link on the canvas is refused,
 * so a press and a move on a picture is the canvas's block drag (a picture
 * moved within a gallery) rather than the browser dragging the file away;
 * words in a text being edited still drag.
 *
 * @module canvas/canvas-native-drag.test
 */
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
} from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { Canvas } from "./canvas";

afterEach(cleanup);

beforeAll(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/picture",
        version: 1,
        description: "A picture.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement(
            "figure",
            { className },
            createElement("img", { alt: "A ridge", src: "data:," })
          ),
      },
      {
        name: "acme/words",
        version: 1,
        description: "Words being edited.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement(
            "p",
            {
              className,
              contentEditable: true,
              suppressContentEditableWarning: true,
            },
            createElement("a", { href: "/x" }, "a link in words")
          ),
      },
    ] as never,
    { source: "canvas-native-drag-test" }
  );
});
afterAll(clearBlocks);

const DOCUMENT: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "pic", type: "acme/picture", version: 1, props: {} },
    { id: "words", type: "acme/words", version: 1, props: {} },
  ],
};

/** Whether a drag started on `element` was refused. */
function refused(element: Element): boolean {
  const event = createEvent.dragStart(element);
  fireEvent(element, event);
  return event.defaultPrevented;
}

describe("the browser's own drag on the canvas", () => {
  it("is refused for a picture, and kept for words being edited", () => {
    const { container } = render(
      <Canvas
        document={DOCUMENT}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId={null}
      />
    );
    const picture = container.querySelector("img");
    const link = container.querySelector("a");
    if (picture === null || link === null) throw new Error("not drawn");
    expect(refused(picture)).toBe(true);
    expect(refused(link)).toBe(false);
  });
});
