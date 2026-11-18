// @vitest-environment jsdom

/**
 * Which entry of each list the author clicked on the canvas: read from the
 * element pressed, kept for the block the click selected, and forgotten for
 * any other block, so a block selected from Layers samples the first entry.
 */
import {
  blockTypeClassName,
  COLLECTION_LIST_TYPE,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { afterEach, describe, expect, it } from "vitest";

import {
  clickedEntryOf,
  forgetClickedEntries,
  rememberClickedEntries,
} from "./clicked-entry";
import { CANVAS_ROOT_CLASS } from "./shell-state";

const LIST_CLASS = blockTypeClassName(COLLECTION_LIST_TYPE);

/** A list element, as the canvas draws it, with one entry per title. */
function list(id: string, entries: readonly Element[][]): HTMLElement {
  const root = document.createElement("div");
  root.className = LIST_CLASS;
  root.setAttribute(NODE_ID_ATTRIBUTE, id);
  // The note an author sees goes above the entries, and is no entry.
  const note = document.createElement("p");
  root.append(note);
  for (const children of entries) {
    const entry = document.createElement("div");
    entry.className = `${LIST_CLASS} nx-child-gap`;
    entry.append(...children);
    root.append(entry);
  }
  return root;
}

/** A heading block with `id`. */
function heading(id: string): HTMLElement {
  const element = document.createElement("h3");
  element.setAttribute(NODE_ID_ATTRIBUTE, id);
  element.append(document.createElement("span"));
  return element;
}

/** `content` inside a canvas root on the page. */
function onCanvas(content: Element): void {
  const canvas = document.createElement("div");
  canvas.className = CANVAS_ROOT_CLASS;
  canvas.append(content);
  document.body.append(canvas);
}

afterEach(() => {
  document.body.replaceChildren();
  forgetClickedEntries();
});

describe("the entry an author clicked", () => {
  it("is the entry's place among its list's entries, for the block selected", () => {
    const second = heading("h");
    onCanvas(list("list", [[heading("h")], [second], [heading("h")]]));
    rememberClickedEntries("h", second.firstElementChild);
    expect(clickedEntryOf("h", "list")).toBe(1);
  });

  it("is kept for each list around the block, inner and outer", () => {
    const pressed = heading("h");
    const inner = list("inner", [[heading("h")], [heading("h")], [pressed]]);
    onCanvas(list("outer", [[], [inner]]));
    rememberClickedEntries("h", pressed);
    expect(clickedEntryOf("h", "inner")).toBe(2);
    expect(clickedEntryOf("h", "outer")).toBe(1);
  });

  it("is not said for another block, so it samples the first entry", () => {
    const second = heading("h");
    onCanvas(list("list", [[heading("h")], [second]]));
    rememberClickedEntries("h", second);
    expect(clickedEntryOf("other", "list")).toBeUndefined();
    // A later selection made without a click on an entry forgets it.
    rememberClickedEntries("other", null);
    expect(clickedEntryOf("h", "list")).toBeUndefined();
  });

  it("reads nothing outside the canvas", () => {
    const second = heading("h");
    document.body.append(list("list", [[heading("h")], [second]]));
    rememberClickedEntries("h", second);
    expect(clickedEntryOf("h", "list")).toBeUndefined();
  });
});
