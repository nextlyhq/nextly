// @vitest-environment jsdom

/**
 * "Keep out of search previews" in the Advanced tab: offered on every
 * container, a switch that marks the block so its root carries
 * `data-nosnippet`, stored only while on, and a note where the block's tag is
 * one Google does not read the mark on.
 *
 * @module never-quote.test
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
import { NeverQuote } from "./never-quote";

afterEach(cleanup);

let editorRef: EditorState | null = null;

function Host({
  document,
  heldBy,
}: {
  document: BlockDocument;
  heldBy?: string;
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  return <NeverQuote editor={editor} nodeId="a" heldBy={heldBy} />;
}

function pageWith(
  type: string,
  props: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "a", type, version: 1, props, ...extra }],
  } as BlockDocument;
}

const stored = () => findNode(editorRef!.document.nodes, "a");

/** Every container, as the tag it renders by default. */
const CONTAINERS: ReadonlyArray<readonly [string, string]> = [
  ["core/section", "section"],
  ["core/box", "div"],
  ["core/card", "div"],
  ["core/columns", "div"],
  ["core/column", "div"],
  ["core/accordion", "div"],
  ["core/gallery", "div"],
];

describe("NeverQuote", () => {
  it.each(CONTAINERS)("is offered on %s", (type, as) => {
    render(<Host document={pageWith(type, { as })} />);
    expect(
      screen.getByRole("switch", { name: "Keep out of search previews" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Google won't show this block's text under the page's link, or use it as a direct source in AI Overviews and AI Mode. Visitors still see it."
      )
    ).toBeTruthy();
  });

  it.each(["core/heading", "core/text", "core/button"])(
    "is not offered on %s, which is no container",
    type => {
      const { container } = render(<Host document={pageWith(type)} />);
      expect(container.innerHTML).toBe("");
    }
  );

  it("marks the block when turned on, and stores nothing once turned off", () => {
    render(<Host document={pageWith("core/section", { as: "section" })} />);
    const toggle = screen.getByRole("switch", {
      name: "Keep out of search previews",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    act(() => toggle.click());
    expect(stored()?.nosnippet).toBe(true);
    expect(screen.getByText("data-nosnippet")).toBeTruthy();

    act(() =>
      screen
        .getByRole("switch", { name: "Keep out of search previews" })
        .click()
    );
    expect(stored()).not.toHaveProperty("nosnippet");
  });

  it.each([
    ["core/section", { as: "header" }],
    ["core/section", { as: "main" }],
    ["core/box", { as: "article" }],
    ["core/box", { as: "div", link: "https://example.com" }],
    ["core/card", { as: "aside" }],
    ["core/card", { as: "div", link: "https://example.com" }],
    ["core/columns", { as: "article" }],
    ["core/accordion", { as: "article" }],
    ["core/gallery", { as: "article" }],
  ])("says Google won't read the mark on %s with %j", (type, props) => {
    render(<Host document={pageWith(type, props, { nosnippet: true })} />);
    expect(
      screen.getByText(
        "Google reads this only when the HTML tag is section or div."
      )
    ).toBeTruthy();
  });

  it.each([
    ["core/box", { as: "div" }],
    ["core/card", { as: "section" }],
    ["core/columns", { as: "div" }],
    ["core/gallery", { as: "section" }],
  ])("says nothing more on %s with %j", (type, props) => {
    render(<Host document={pageWith(type, props, { nosnippet: true })} />);
    expect(
      screen.queryByText(
        "Google reads this only when the HTML tag is section or div."
      )
    ).toBeNull();
  });

  it("marks a card, a container that newly offers it", () => {
    render(<Host document={pageWith("core/card", { as: "div" })} />);
    act(() =>
      screen
        .getByRole("switch", { name: "Keep out of search previews" })
        .click()
    );
    expect(stored()?.nosnippet).toBe(true);
  });

  it("is held while a lock holds the block's design", () => {
    render(
      <Host
        document={pageWith("core/section", { as: "section" })}
        heldBy="Locked"
      />
    );
    expect(
      screen
        .getByRole("switch", { name: "Keep out of search previews" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
