// @vitest-environment jsdom

/**
 * An image on the canvas is not drawn again from scratch when an edit leaves
 * it alone, or changes something about it other than its source.
 *
 * A remounted `<img>` is a new element, which the browser loads again: the
 * picture blinks out and back on every keystroke in the block beside it. The
 * element surviving the re-render is what an author sees as a steady page.
 *
 * @module canvas-remount.test
 */
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
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
        description: "An image.",
        example: { props: { src: "/a.png", alt: "" } },
        render: ({
          className,
          props,
        }: {
          className: string;
          props: { src: string; alt: string };
        }) =>
          createElement("img", { className, src: props.src, alt: props.alt }),
      },
      {
        name: "acme/words",
        version: 1,
        description: "Some words.",
        example: { props: { text: "" } },
        render: ({
          className,
          props,
        }: {
          className: string;
          props: { text: string };
        }) => createElement("p", { className }, props.text),
      },
    ] as never,
    { source: "canvas-remount-test" }
  );
});
afterAll(clearBlocks);

function page(alt: string, text: string): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "picture",
        type: "acme/picture",
        version: 1,
        props: { src: "/photo.png", alt },
      } as BlockNode,
      {
        id: "words",
        type: "acme/words",
        version: 1,
        props: { text },
      } as BlockNode,
    ],
  };
}

function canvas(document: BlockDocument): React.JSX.Element {
  return (
    <Canvas
      document={document}
      siteStyles={{ breakpoints: { viewport: [], container: [] } }}
    />
  );
}

const image = () => document.querySelector("img");

describe("an image on the canvas", () => {
  it("keeps its element when the block beside it is edited", async () => {
    const { rerender } = render(canvas(page("", "First")));
    await act(async () => undefined);
    const before = image();
    expect(before).not.toBeNull();

    rerender(canvas(page("", "First, edited")));
    await act(async () => undefined);

    expect(document.querySelector("p")?.textContent).toBe("First, edited");
    expect(image()).toBe(before);
  });

  it("keeps its element when its own text changes but not its source", async () => {
    const { rerender } = render(canvas(page("", "Words")));
    await act(async () => undefined);
    const before = image();

    rerender(canvas(page("A photo", "Words")));
    await act(async () => undefined);

    expect(image()?.getAttribute("alt")).toBe("A photo");
    expect(image()).toBe(before);
  });
});
