// @vitest-environment jsdom
/** A hidden panel is kept mounted and drawn again only once it shows. */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { keptWhileHidden, ownBlockChanged } from "./kept-while-hidden";

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

describe("ownBlockChanged", () => {
  const first = { id: "a", type: "acme/text", version: 1, props: { t: "1" } };
  const second = { id: "b", type: "acme/text", version: 1, props: { t: "2" } };
  /** A page of these nodes, as an editor holds it. */
  const pageOf = (...nodes: unknown[]) =>
    ({ formatVersion: 1, kind: "page", nodes }) as unknown as BlockDocument;
  /** A Content tab's props, drawn for `nodeId` on `document`. */
  const tab = (nodeId: string, document: BlockDocument) => ({
    block: { nodeId },
    editor: { document },
  });

  it("hears its own block change", () => {
    const changed = { ...first, props: { t: "9" } };
    expect(
      ownBlockChanged(
        tab("a", pageOf(first, second)),
        tab("a", pageOf(changed, second))
      )
    ).toBe(true);
  });

  it("hears nothing for another block's change, or another block selected", () => {
    const other = { ...second, props: { t: "9" } };
    expect(
      ownBlockChanged(
        tab("a", pageOf(first, second)),
        tab("a", pageOf(first, other))
      )
    ).toBe(false);
    expect(
      ownBlockChanged(
        tab("a", pageOf(first, second)),
        tab("b", pageOf({ ...first, props: { t: "9" } }, second))
      )
    ).toBe(false);
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
