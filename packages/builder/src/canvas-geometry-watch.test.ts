// @vitest-environment jsdom

/**
 * A batch of mutations that changed nothing is not a change.
 *
 * An overlay that MEASURES by writing has to write into the subtree it watches:
 * the spacing probe pushes a value, reads the edge and puts the attribute back,
 * all inside one task. Reacting to that would have every measurement schedule
 * the next one forever. Remembering the answers instead avoids that and buys a
 * staleness of its own, since the applied CSS changes for reasons nothing here
 * reports. Ignoring a net-zero batch removes the need to choose between them.
 *
 * @module canvas-geometry-watch.test
 */

import { afterEach, describe, expect, it } from "vitest";

import { watchCanvasFor } from "./canvas-geometry-watch";
import { CANVAS_ROOT_CLASS } from "./shell-state";

function canvas(): {
  root: HTMLElement;
  layer: HTMLElement;
  block: HTMLElement;
} {
  const root = document.createElement("div");
  root.className = CANVAS_ROOT_CLASS;
  const layer = document.createElement("div");
  const block = document.createElement("div");
  root.append(block, layer);
  document.body.append(root);
  return { root, layer, block };
}

/** Let the `MutationObserver` deliver, which it does as a microtask. */
async function delivered(): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("a batch that changed nothing", () => {
  it("does not re-measure for a probe that put the attribute back", async () => {
    const { layer, block } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    // Exactly what the spacing probe does: write, read, restore, in one task.
    const had = block.getAttribute("style");
    block.style.setProperty("margin-bottom", "30px", "important");
    block.getBoundingClientRect();
    if (had === null) block.removeAttribute("style");
    else block.setAttribute("style", had);

    await delivered();
    expect(moves).toBe(0);
    stop?.();
  });

  /*
   * The control, and the half that makes the assertion above mean anything: a
   * real change to the same attribute on the same element still arrives. Without
   * it, a filter that dropped everything would pass.
   */
  it("still re-measures for a change that stuck", async () => {
    const { layer, block } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    block.style.setProperty("margin-bottom", "30px");

    await delivered();
    expect(moves).toBe(1);
    stop?.();
  });

  /*
   * A node arriving is a change by construction, whatever the attributes in the
   * same batch did — a recompiled site sheet is a `childList` record, and
   * dropping it would leave every overlay drawn at the old rule's coordinates.
   */
  it("re-measures for a node arriving even beside a restored attribute", async () => {
    const { root, layer, block } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    const had = block.getAttribute("style");
    block.style.setProperty("margin-bottom", "30px", "important");
    if (had === null) block.removeAttribute("style");
    else block.setAttribute("style", had);
    root.append(document.createElement("style"));

    await delivered();
    expect(moves).toBe(1);
    stop?.();
  });

  /*
   * A NAMESPACED attribute is addressed by its namespace, not by the local name
   * the record reports. `MutationRecord.attributeName` for `xlink:href` is
   * `href`, and `getAttribute("href")` answers `null` for it however it was
   * set — so comparing by local name asks about a different, absent attribute,
   * finds `null` on both sides, and passes a real change off as no change.
   */
  it("re-measures for a namespaced attribute the local name cannot see", async () => {
    const { root, layer } = canvas();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    svg.append(use);
    root.append(svg);
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#icon");

    await delivered();
    expect(moves).toBe(1);
    stop?.();
  });

  /*
   * And the caller's OWN output is still its own. A net-zero test would let a
   * layer's real redraw through if ownership stopped being checked.
   */
  it("still ignores the caller's own output", async () => {
    const { layer } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    layer.append(document.createElement("div"));

    await delivered();
    expect(moves).toBe(0);
    stop?.();
  });
});
