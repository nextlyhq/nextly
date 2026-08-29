// @vitest-environment jsdom

/**
 * Whether the rendered tag survives a canvas that mounts LATE.
 *
 * The builder mounts its canvas only once styles have loaded, while the
 * inspector beside it stays mounted throughout. So the first run of this hook
 * genuinely has no canvas to read, and the question is whether it ever looks
 * again — a ref would not tell it to, because assigning `.current` changes no
 * dependency and a ref is not reactive. Answered wrongly, a heading reports its
 * size as unset for the rest of the session, which is the state this whole tier
 * exists to fix.
 *
 * @module __tests__/use-rendered-tag
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { EditorState } from "./editor-state";
import { useRenderedTag } from "./use-rendered-tag";

afterEach(cleanup);

/** A document object, which this hook only ever uses as a change signal. */
const DOCUMENT = {} as EditorState["document"];

function Reader({ root }: { root: HTMLElement | null }) {
  const tag = useRenderedTag(root, "n1", DOCUMENT);
  return <span data-testid="tag">{tag ?? "unknown"}</span>;
}

describe("reading the tag from a canvas", () => {
  it("answers once a canvas that mounted LATE appears", () => {
    const canvas = document.createElement("div");
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';

    // The state the inspector really starts in: mounted, with no canvas yet.
    const view = render(<Reader root={null} />);
    expect(screen.getByTestId("tag").textContent).toBe("unknown");

    // The canvas arrives. Passed as a VALUE, this is a dependency change; held
    // as a ref it would not be, and the hook would never look again.
    view.rerender(<Reader root={canvas} />);
    expect(screen.getByTestId("tag").textContent).toBe("h1");
  });

  it("answers when an ASYNC block resolves inside a canvas already mounted", async () => {
    /*
     * A block whose `render` returns a promise commits its Suspense fallback
     * first and its resolved root later. Nothing in this hook's arguments
     * changes across that: the canvas element is the same, the selection is the
     * same, the document is the same. So a dependency-driven read runs only
     * BEFORE the marked element exists, and an async block resolving to a
     * heading reports its size as unset for as long as it stays selected.
     */
    const canvas = document.createElement("div");
    // The state during suspense: the canvas is mounted and the node is not
    // drawn yet.
    canvas.innerHTML = "<div>loading</div>";

    render(<Reader root={canvas} />);
    expect(screen.getByTestId("tag").textContent).toBe("unknown");

    // The block resolves. No prop changes — only the DOM.
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';
    await waitFor(() =>
      expect(screen.getByTestId("tag").textContent).toBe("h1")
    );
  });

  it("follows a node id that MOVES to a different element", async () => {
    // Structure alone is not the whole question: a re-render can put the same
    // id on a different element without adding or removing one, and the answer
    // changes. That is why the observer watches the attribute too.
    const canvas = document.createElement("div");
    canvas.innerHTML =
      '<h1 data-nx-node="n1">A title</h1><p id="other">text</p>';

    render(<Reader root={canvas} />);
    expect(screen.getByTestId("tag").textContent).toBe("h1");

    const heading = canvas.querySelector("h1");
    heading?.removeAttribute("data-nx-node");
    canvas.querySelector("#other")?.setAttribute("data-nx-node", "n1");
    await waitFor(() =>
      expect(screen.getByTestId("tag").textContent).toBe("p")
    );
  });

  it("goes back to unknown when the canvas goes away", () => {
    // The control on the case above: a hook that simply latched its first
    // non-empty answer would satisfy it while reporting a heading's baseline
    // for a canvas that is no longer on screen.
    const canvas = document.createElement("div");
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';

    const view = render(<Reader root={canvas} />);
    expect(screen.getByTestId("tag").textContent).toBe("h1");

    view.rerender(<Reader root={null} />);
    expect(screen.getByTestId("tag").textContent).toBe("unknown");
  });
});
