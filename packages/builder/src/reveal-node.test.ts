// @vitest-environment jsdom

/**
 * Bringing one block into view by its id, inside the root it is handed.
 *
 * The cases are written against the two plausible wrong versions: one that
 * searches the global document (and so finds a same-id node outside the canvas,
 * or nothing once the canvas lives in a frame), and one that animates the
 * scroll for a reader who asked the system for less motion.
 *
 * @module reveal-node.test
 */
import { INSTANCE_ATTRIBUTE, NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { revealNode } from "./reveal-node";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** A root holding the given ids, each with a spy where it would scroll. */
function canvasWith(ids: readonly string[]): {
  root: HTMLElement;
  scrolls: Map<string, ReturnType<typeof vi.fn>>;
} {
  const root = document.createElement("div");
  const scrolls = new Map<string, ReturnType<typeof vi.fn>>();
  for (const id of ids) {
    const element = document.createElement("section");
    element.setAttribute(NODE_ID_ATTRIBUTE, id);
    const scroll = vi.fn();
    element.scrollIntoView = scroll;
    scrolls.set(id, scroll);
    root.append(element);
  }
  document.body.append(root);
  return { root, scrolls };
}

function motionPreference(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion: reduce"),
      media: query,
    }))
  );
}

describe("revealNode", () => {
  it("scrolls the named block to the nearest edge and says it did", () => {
    motionPreference(false);
    const { root, scrolls } = canvasWith(["a", "b", "c"]);

    expect(revealNode(root, "b")).toBe(true);

    expect(scrolls.get("b")).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
    expect(scrolls.get("a")).not.toHaveBeenCalled();
    expect(scrolls.get("c")).not.toHaveBeenCalled();
  });

  it("jumps rather than animates when the reader asked for less motion", () => {
    motionPreference(true);
    const { root, scrolls } = canvasWith(["a"]);

    revealNode(root, "a");

    expect(scrolls.get("a")).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "auto" })
    );
  });

  it("returns false and scrolls nothing for an id the root does not hold", () => {
    motionPreference(false);
    const { root, scrolls } = canvasWith(["a"]);

    expect(revealNode(root, "gone")).toBe(false);
    expect(scrolls.get("a")).not.toHaveBeenCalled();
  });

  it("searches only the root it is handed, never the whole document", () => {
    motionPreference(false);
    // The same id outside the canvas: a page's preview elsewhere on the screen
    // draws the same document, and so the same ids.
    const outside = canvasWith(["a"]);
    const inside = canvasWith([]);

    expect(revealNode(inside.root, "a")).toBe(false);
    expect(outside.scrolls.get("a")).not.toHaveBeenCalled();
  });

  it("finds an id that would need escaping in a selector", () => {
    motionPreference(false);
    const id = 'quote"] , [x="';
    const { root, scrolls } = canvasWith([id]);

    expect(revealNode(root, id)).toBe(true);
    expect(scrolls.get(id)).toHaveBeenCalled();
  });

  it("finds a placed component by its instance, which draws no element of its own", () => {
    // The definition's nodes carry ids minted for the drawing; the instance the
    // editor holds is named on them by the instance attribute, outermost first.
    motionPreference(false);
    const root = document.createElement("div");
    const outer = document.createElement("header");
    outer.setAttribute(NODE_ID_ATTRIBUTE, "minted-1");
    outer.setAttribute(INSTANCE_ATTRIBUTE, "host");
    const inner = document.createElement("p");
    inner.setAttribute(NODE_ID_ATTRIBUTE, "minted-2");
    inner.setAttribute(INSTANCE_ATTRIBUTE, "host");
    outer.append(inner);
    root.append(outer);
    document.body.append(root);
    const outerScroll = vi.fn();
    const innerScroll = vi.fn();
    outer.scrollIntoView = outerScroll;
    inner.scrollIntoView = innerScroll;

    expect(revealNode(root, "host")).toBe(true);
    expect(outerScroll).toHaveBeenCalledTimes(1);
    expect(innerScroll).not.toHaveBeenCalled();
  });

  it("searches a whole document when that is the root, as a frame's would be", () => {
    motionPreference(false);
    const { scrolls } = canvasWith(["a"]);

    expect(revealNode(document, "a")).toBe(true);
    expect(scrolls.get("a")).toHaveBeenCalled();
  });
});
