// @vitest-environment jsdom

/**
 * A text block emptied of its words keeps a line of height on the canvas, so
 * there is still something to click. Only text: a spacer or an image that
 * draws nothing inside it has a size of its own, which the canvas keeps as the
 * published page does.
 */
import { afterEach, describe, expect, it } from "vitest";

import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import { EMPTY_TEXT_SELECTOR } from "./empty-slot";

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.className = "";
});

/** A canvas in a builder's chrome, holding the given page. */
function canvasWith(page: string): HTMLElement {
  document.documentElement.classList.add("nx-builder-chrome");
  document.body.innerHTML = `<div class="nx-canvas">${page}</div>`;
  const canvas = document.querySelector<HTMLElement>(".nx-canvas");
  if (canvas === null) throw new Error("no canvas");
  return canvas;
}

const matches = (canvas: HTMLElement, selector: string): boolean =>
  canvas.querySelector(selector)?.matches(EMPTY_TEXT_SELECTOR) === true;

describe("an emptied text block", () => {
  it("is matched: a block's own text, and a placement's cleared value", () => {
    const canvas = canvasWith(
      `<h2 data-nx-node="heading"></h2>` +
        `<div data-nx-node="card"><p data-nx-prop="body" id="value"></p></div>`
    );
    expect(matches(canvas, "h2")).toBe(true);
    expect(matches(canvas, "#value")).toBe(true);
  });

  it("is not matched while it holds words", () => {
    const canvas = canvasWith(`<h2 data-nx-node="heading">Hello</h2>`);
    expect(matches(canvas, "h2")).toBe(false);
  });

  it("leaves blocks that are not text at their own size", () => {
    const canvas = canvasWith(
      `<div data-nx-node="spacer" style="height: 8px"></div>` +
        `<img data-nx-node="photo" alt="">`
    );
    expect(matches(canvas, "div")).toBe(false);
    expect(matches(canvas, "img")).toBe(false);
  });

  it("is given a line of height by the frame's sheet", () => {
    expect(CANVAS_FRAME_SHEET).toContain(
      `${EMPTY_TEXT_SELECTOR} { min-height: 1lh; }`
    );
  });
});
