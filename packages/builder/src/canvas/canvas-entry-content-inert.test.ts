// @vitest-environment jsdom
/**
 * The canvas makes the entry's blocks Entry content draws inert, and gives
 * back only the inert it added: a block whose own root is inert keeps it once
 * it is no longer drawn there, while one the canvas made inert is freed.
 */
import { ENTRY_CONTENT_DRAWN_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import {
  ENTRY_CONTENT_INERT_ATTRIBUTE,
  markEntryContentInert,
  observeEntryContentInertOwnership,
} from "./canvas";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/** A canvas holding one Entry content wrapper with the two blocks in it. */
function drawn() {
  const canvas = document.createElement("div");
  canvas.className = CANVAS_ROOT_CLASS;
  const wrapper = document.createElement("div");
  wrapper.setAttribute(ENTRY_CONTENT_DRAWN_ATTRIBUTE, "");
  // A block whose own root is inert, as a custom block may render it.
  const ownInert = document.createElement("section");
  ownInert.setAttribute("inert", "");
  const plain = document.createElement("section");
  wrapper.append(ownInert, plain);
  canvas.append(wrapper);
  document.body.append(canvas);
  return { canvas, wrapper, ownInert, plain };
}

/** Lets a mutation observer deliver what it has queued. */
function delivered(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("the inert the canvas gives Entry content's blocks", () => {
  it("makes every block drawn there inert, the block's own inert included", () => {
    const { canvas, ownInert, plain } = drawn();
    markEntryContentInert(canvas);
    expect(plain.hasAttribute("inert")).toBe(true);
    expect(ownInert.hasAttribute("inert")).toBe(true);
    expect(plain.hasAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)).toBe(true);
    expect(ownInert.hasAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)).toBe(true);
    canvas.remove();
  });

  it("keeps a block's own inert when the block moves out of Entry content", () => {
    const { canvas, ownInert, plain } = drawn();
    markEntryContentInert(canvas);
    // Reparented out of the wrapper, as a drop or a reconciliation may.
    canvas.append(ownInert, plain);
    markEntryContentInert(canvas);
    // The inert the block rendered itself stays; only the mark goes.
    expect(ownInert.hasAttribute("inert")).toBe(true);
    expect(ownInert.hasAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)).toBe(false);
    // The control: the inert the canvas added is given back.
    expect(plain.hasAttribute("inert")).toBe(false);
    expect(plain.hasAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)).toBe(false);
    canvas.remove();
  });

  it("still knows the inert was the block's own after marking it again", () => {
    const { canvas, ownInert } = drawn();
    markEntryContentInert(canvas);
    // Re-marked while still drawn there, as every render does.
    markEntryContentInert(canvas);
    canvas.append(ownInert);
    markEntryContentInert(canvas);
    expect(ownInert.hasAttribute("inert")).toBe(true);
    canvas.remove();
  });

  it("frees a block that gave up its own inert while drawn there", () => {
    const { canvas, ownInert } = drawn();
    markEntryContentInert(canvas);
    // The block re-renders without inert, as React removes the attribute.
    ownInert.removeAttribute("inert");
    markEntryContentInert(canvas);
    // Still drawn in Entry content, so still inert: now the canvas's.
    expect(ownInert.hasAttribute("inert")).toBe(true);
    canvas.append(ownInert);
    markEntryContentInert(canvas);
    expect(ownInert.hasAttribute("inert")).toBe(false);
    canvas.remove();
  });

  it("holds a block inert at once when it drops its own, with no new pass", async () => {
    const { canvas, ownInert } = drawn();
    const stop = observeEntryContentInertOwnership(canvas);
    markEntryContentInert(canvas);
    ownInert.removeAttribute("inert");
    await delivered();
    expect(ownInert.hasAttribute("inert")).toBe(true);
    expect(ownInert.getAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)).toBe("added");
    stop();
    canvas.remove();
  });

  it("keeps the inert a block takes on after the canvas made it inert", async () => {
    const { canvas, plain } = drawn();
    const stop = observeEntryContentInertOwnership(canvas);
    markEntryContentInert(canvas);
    await delivered();
    // The control: the canvas's own write leaves the inert the canvas's.
    expect(plain.getAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)).toBe("added");
    // The block re-renders inert itself: a write to an attribute present.
    plain.setAttribute("inert", "");
    await delivered();
    expect(plain.getAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)).toBe("kept");
    canvas.append(plain);
    markEntryContentInert(canvas);
    expect(plain.hasAttribute("inert")).toBe(true);
    stop();
    canvas.remove();
  });

  it("reads the block's write before a pass in the same commit frees it", () => {
    const { canvas, plain } = drawn();
    const stop = observeEntryContentInertOwnership(canvas);
    markEntryContentInert(canvas);
    // The block turns inert and leaves Entry content in one commit, and the
    // pass runs before the observer has delivered the block's write.
    plain.setAttribute("inert", "");
    canvas.append(plain);
    markEntryContentInert(canvas);
    expect(plain.hasAttribute("inert")).toBe(true);
    stop();
    canvas.remove();
  });
});
