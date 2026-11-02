/**
 * @vitest-environment jsdom
 */
/**
 * Opening the editor at the section its address names.
 *
 * The wrong versions this separates: one that selects but never scrolls (the
 * author lands at the top of a long page with an outline somewhere below), one
 * that scrolls once and gives up when the canvas draws after it looked, one
 * that selects whatever id it is handed (an address naming a deleted section
 * would leave a selection with nothing on screen), and one that re-runs on
 * every render and drags the author back each time they scroll away.
 */
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOpenAtSection } from "./use-open-at-section";

afterEach(() => {
  document.body.innerHTML = "";
});

const DOCUMENT = {
  nodes: [
    { id: "hero", type: "core/section", version: 1, props: {} },
    {
      id: "plans",
      type: "core/section",
      version: 1,
      props: {},
      slots: {
        children: [{ id: "nested", type: "core/text", version: 1, props: {} }],
      },
    },
  ],
};

function drawn(canvas: HTMLElement, id: string): ReturnType<typeof vi.fn> {
  const element = document.createElement("section");
  element.setAttribute(NODE_ID_ATTRIBUTE, id);
  const scroll = vi.fn();
  element.scrollIntoView = scroll;
  canvas.append(element);
  return scroll;
}

function canvasElement(): HTMLDivElement {
  const canvas = document.createElement("div");
  document.body.append(canvas);
  return canvas;
}

function setup(sectionId: string | undefined, canvas: HTMLElement | null) {
  const select = vi.fn();
  const requestPanel = vi.fn();
  const hook = renderHook(
    ({ canvas: root }: { canvas: HTMLElement | null }) =>
      useOpenAtSection({
        sectionId,
        editor: { document: DOCUMENT as never, select },
        canvas: root,
        requestPanel,
      }),
    { initialProps: { canvas } }
  );
  return { select, requestPanel, hook };
}

describe("useOpenAtSection", () => {
  it("selects the section, shows Layers and scrolls the section into view", () => {
    const canvas = canvasElement();
    const scroll = drawn(canvas, "plans");

    const { select, requestPanel } = setup("plans", canvas);

    expect(select).toHaveBeenCalledWith("plans");
    expect(requestPanel).toHaveBeenCalledWith("layers");
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a section the page no longer has", () => {
    const canvas = canvasElement();
    const scroll = drawn(canvas, "hero");

    const { select, requestPanel } = setup("deleted", canvas);

    expect(select).not.toHaveBeenCalled();
    expect(requestPanel).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does nothing for a block that is not a section of the page", () => {
    // A section is a top-level block; an address naming a nested one names no
    // section the entry screen offered.
    const { select } = setup("nested", canvasElement());
    expect(select).not.toHaveBeenCalled();
  });

  it("does nothing when the address names no section", () => {
    const { select, requestPanel } = setup(undefined, canvasElement());
    expect(select).not.toHaveBeenCalled();
    expect(requestPanel).not.toHaveBeenCalled();
  });

  it("scrolls once the canvas exists, when it mounts after the editor", () => {
    const { hook } = setup("hero", null);
    const canvas = canvasElement();
    const scroll = drawn(canvas, "hero");

    hook.rerender({ canvas });

    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("scrolls once the section is drawn, when the canvas draws it later", async () => {
    const canvas = canvasElement();
    setup("hero", canvas);

    const scroll = drawn(canvas, "hero");
    // The observer reports on a microtask after the mutation.
    await act(async () => {
      await Promise.resolve();
    });

    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("scrolls only once, however often the editor renders after", () => {
    const canvas = canvasElement();
    const scroll = drawn(canvas, "hero");
    const { hook, select } = setup("hero", canvas);

    hook.rerender({ canvas });
    hook.rerender({ canvas });

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
