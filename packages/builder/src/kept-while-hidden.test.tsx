// @vitest-environment jsdom
/** A hidden panel is kept mounted and drawn again only once it shows. */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { keptWhileHidden } from "./kept-while-hidden";

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
