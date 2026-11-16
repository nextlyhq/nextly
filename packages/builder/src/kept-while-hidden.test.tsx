// @vitest-environment jsdom
/** A hidden panel is kept mounted and drawn again only once it shows. */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { BlockInspection } from "./inspector";
import { keptWhileHidden, ownHtmlChanged } from "./kept-while-hidden";

afterEach(cleanup);

describe("keptWhileHidden", () => {
  it("draws a panel as it hides and shows, and never while hidden", () => {
    const drawn: string[] = [];
    function Panel({ onScreen, label }: { onScreen: boolean; label: string }) {
      drawn.push(`${label}:${String(onScreen)}`);
      return <p>{label}</p>;
    }
    const Kept = keptWhileHidden(Panel);
    const view = render(<Kept onScreen label="a" />);
    view.rerender(<Kept onScreen label="b" />);
    // Hiding draws once, so the panel hears it left the screen.
    view.rerender(<Kept onScreen={false} label="c" />);
    // Hidden: what it is handed changes, and nothing is drawn.
    view.rerender(<Kept onScreen={false} label="d" />);
    view.rerender(<Kept onScreen={false} label="e" />);
    // Kept mounted: it still shows what it last drew.
    expect(view.getByText("c")).toBeTruthy();
    // Shown again, for what it is handed now.
    view.rerender(<Kept onScreen label="f" />);
    expect(drawn).toEqual(["a:true", "b:true", "c:false", "f:true"]);
  });
});

describe("ownHtmlChanged", () => {
  /** A Content tab's props for `nodeId`, holding `cssId` and `attributes`. */
  const tab = (
    nodeId: string,
    cssId: string | undefined,
    attributes?: Record<string, string>
  ) => ({ block: { nodeId, html: { cssId, attributes } } as BlockInspection });

  it("hears its own block's CSS id or attributes change", () => {
    expect(ownHtmlChanged(tab("a", "intro"), tab("a", undefined))).toBe(true);
    expect(
      ownHtmlChanged(
        tab("a", undefined, { "data-x": "1" }),
        tab("a", undefined, { "data-x": "2" })
      )
    ).toBe(true);
  });

  it("hears nothing when they are as they were, or another block is selected", () => {
    expect(
      ownHtmlChanged(
        tab("a", "intro", { "data-x": "1" }),
        tab("a", "intro", { "data-x": "1" })
      )
    ).toBe(false);
    expect(ownHtmlChanged(tab("a", "intro"), tab("b", undefined))).toBe(false);
  });

  it("draws a hidden panel again for what it hears", () => {
    const drawn: string[] = [];
    function Panel({ onScreen, label }: { onScreen: boolean; label: string }) {
      drawn.push(`${label}:${String(onScreen)}`);
      return <p>{label}</p>;
    }
    const Kept = keptWhileHidden(Panel, (before, after) =>
      after.label.startsWith("heard")
    );
    const view = render(<Kept onScreen={false} label="a" />);
    view.rerender(<Kept onScreen={false} label="b" />);
    view.rerender(<Kept onScreen={false} label="heard c" />);
    expect(drawn).toEqual(["a:false", "heard c:false"]);
  });
});
